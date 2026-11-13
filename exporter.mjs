// Transforme donnees.json (sortie d'agreger.mjs) en tables JSON pour le tableau de bord (dossier export/).
// Usage : node exporter.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controler, rapport } from './controles.mjs';
import { DONNEES, RESETS, TROUS, ici } from './config.mjs';
import { execFileSync } from 'node:child_process';

const d = JSON.parse(readFileSync(join(DONNEES, 'donnees.json'), 'utf8'));
const sortie = join(DONNEES, 'export');
mkdirSync(sortie, { recursive: true });

// Un seul « maintenant » pour tout l'export et ses contrôles (13/11) : sinon, autour du dimanche 10:00 UTC, l'export
// et les contrôles pourraient voir deux semaines différentes
const MAINTENANT = Date.now();
const r2 = n => Math.round(n * 100) / 100;
// Format du 07/11 (dossiers par jour, jours des sessions) : donnees.json plus ancien → relancer agreger.mjs d'abord
if (!d.jourProjet || !d.jourModeleTotal || !d.jourTailles || d.sessions.some(s => !s.jour || !s.jourFin)) {
  console.error('ERREUR : donnees.json vient d\'une ancienne version d\'agreger.mjs (champs par jour ou jour des sessions absents) : relancer node agreger.mjs');
  process.exit(1);
}
// RESETS (resets de la limite hebdo donnés à la main) et TROUS (journaux manquants connus) : config.local.json
const trou = jour => TROUS.find(([a, b]) => jour >= a && jour <= b)?.[2] ?? '';
// Tous les jours du premier au dernier, y compris ceux sans appel (sinon le graphe les fait disparaître)
const joursContinus = () => {
  // Bornes : données et trous déclarés (un trou au début ou à la fin doit apparaître aussi)
  const cles = [...Object.keys(d.parJour), ...TROUS.flatMap(([a, b]) => [a, b])].sort(), out = [];
  if (!cles.length) return out;
  for (let t = Date.parse(cles[0] + 'T12:00:00Z'); t <= Date.parse(cles.at(-1) + 'T12:00:00Z'); t += 864e5) {
    const jour = new Date(t).toISOString().slice(0, 10), v = d.parJour[jour];
    out.push({ jour, cout: v ? r2(v.cout) : 0, appels: v ? v.appels : 0, jetons: v ? jetons(v) : 0, manque: trou(jour) });
  }
  return out;
};
const semainesContinues = () => {
  const cles = Object.keys(d.parSemaine).sort(), out = [];
  const zero = { cout: 0, appels: 0, entree: 0, ecritureCache: 0, lectureCache: 0, sortie: 0, modeles: {} };
  if (!cles.length) return out;
  // Jusqu'à la semaine en cours, même sans réponse encore (juste après la remise à zéro du dimanche 10 h UTC)
  const n = new Date(MAINTENANT - 10 * 36e5), enCours = new Date(n - n.getUTCDay() * 864e5).toISOString().slice(0, 10);
  const fin = Math.max(Date.parse(cles.at(-1) + 'T12:00:00Z'), Date.parse(enCours + 'T12:00:00Z'));
  for (let t = Date.parse(cles[0] + 'T12:00:00Z'); t <= fin; t += 7 * 864e5) {
    const debut = new Date(t).toISOString().slice(0, 10);
    out.push([debut, d.parSemaine[debut] ?? zero]);
  }
  return out;
};
// Groupe de chaque modèle connu (13/11 : Fable ajouté). Modèle absent d'ici (ex. « Opus 4.6 » chez un autre utilisateur) : série à lui,
// clé automatique « m_opus_4-6 » que la page affiche « Opus 4.6 » (légende dynamique, 13/11) ; rien à changer dans la page.
const GROUPES = { 'Fable 5.2': 'fable', 'Fable 5.1': 'fable', 'Fable 5': 'fable', 'Opus 5.5': 'opus55', 'Opus 4.8': 'opus48', 'Sonnet 5.5': 'sonnet', 'Sonnet 5': 'sonnet', 'Haiku 5.5': 'haiku', 'Haiku 4.5': 'haiku' };
const inconnus = new Set();
const cleAuto = m => 'm_' + m.toLowerCase().replace(/(\d)\.(\d)/g, '$1-$2').replace(/[^a-z0-9-]+/g, '_').replace(/^_|_$/g, '');
const groupeDe = m => GROUPES[m] ?? (inconnus.add(m), cleAuto(m));
// Toutes les clés de série, connues et automatiques : mêmes colonnes dans chaque ligne (une semaine sans ce modèle vaut 0)
const SERIES = [...new Set([...Object.values(GROUPES), ...Object.keys(d.parModele ?? {}).map(groupeDe)])];
const parGroupe = (modeles, prefixe = '', arrondi = r2) => {
  const g = Object.fromEntries(SERIES.map(k => [k, 0]));
  for (const [m, v] of Object.entries(modeles)) g[groupeDe(m)] = (g[groupeDe(m)] ?? 0) + v;
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [prefixe + k, arrondi(v)]));
};
const jetons = v => v.entree + v.ecritureCache + v.lectureCache + v.sortie;

// Usage hors de ce PC (Cowork distant sans journal local, claude.ai, téléphone) : entre deux relevés
// hebdo consécutifs de la même semaine, plus d'une heure d'écart, au moins 1 point de hausse pour moins de 0,5 $ par point
// dans les journaux (un point coûte en général bien plus). Ces points sont retirés du % des relevés suivants de la semaine
// (pctLocal) ; une pente ne les enjambe jamais. Les sauts d'une minute (arrondi du %) restent sous le seuil de durée.
// Points retirés = hausse − part payée en local (coût local ÷ prix de référence d'un point : < 0,2 pt par point ici).
// Seuil de 1 point : le % est arrondi à l'entier inférieur, une hausse lue de N points vaut entre
// N − 1 et N + 1 points réels, quel que soit N ; un seuil de 2 points ratait les hausses de 1 point à coût nul
// et faussait des pentes. Chaque période compte donc ±1 point d'incertitude (voir `fourchette`).
// Silence : plus d'une heure sans relevé alors que plus de 5 $ (≈ 2 points) ont été consommés en local = le relevé
// ne tournait pas (ex. sonar fermé pendant deux jours). Un éventuel usage hors PC pendant ce
// silence est invisible : la pente qui l'enjambe est gardée mais marquée `silence` (jamais « définitive » pour la fiche Haiku).
const HORS = { duree: 36e5, points: 1, dollarsParPoint: 0.5, prixPoint: 2.44, silenceDollars: 5 };
// Plafond trop incertain : fourchette plus large que 25 % du plafond central → pas de plafond, la fourchette
// seule dans le statut (ex. semaine où la majorité du % a été prise hors de ce PC).
const LARGEUR_MAX = 0.25;
const hebdoParSemaine = {};
for (const p of d.projections.filter(p => p.type === 'hebdo')) (hebdoParSemaine[p.debutFenetre] ??= []).push(p);
const horsJournaux = [];
for (const v of Object.values(hebdoParSemaine)) {
  v.sort((a, b) => a.releve < b.releve ? -1 : 1);
  let retire = 0;
  v.forEach((b, i) => {
    const a = v[i - 1];
    if (a) {
      const dp = b.pct - a.pct, dc = b.coutAuReleve - a.coutAuReleve, long = Date.parse(b.releve) - Date.parse(a.releve) > HORS.duree;
      if (long && dp >= HORS.points && dc < dp * HORS.dollarsParPoint) {
        const points = Math.round((dp - dc / HORS.prixPoint) * 10) / 10;
        retire += points; b.apresCoupure = true;
        horsJournaux.push({ semaine: b.debutFenetre, debut: a.releve, fin: b.releve, points });
      } else if (long && dc > HORS.silenceDollars) b.apresSilence = true;
    }
    b.pctLocal = Math.max(0, b.pct - retire);
  });
}
// Points consommés hors de ce PC dans la fenêtre commencée à debutFenetre, dans les périodes commencées avant l'instant ts
const horsAvant = (debutFenetre, ts) => horsJournaux.filter(h => h.semaine === debutFenetre && Date.parse(h.debut) < Date.parse(ts))
  .reduce((s, h) => s + h.points, 0);
// Nombre de ces périodes (chacune ±1 point, arrondi du %) : sert à la fourchette du plafond
const nbHorsAvant = (debutFenetre, ts) => horsJournaux.filter(h => h.semaine === debutFenetre && Date.parse(h.debut) < Date.parse(ts)).length;
// Fourchette du plafond : part locale entre local − n et local + n points ; sous 10 % local, borne haute inconnue
const fourchette = (cout, local, n) => ({ min: r2(cout * 100 / (local + n)), max: local - n >= 10 ? r2(cout * 100 / (local - n)) : null });
const usd = n => `${Math.round(n)} $`;

// Coût par groupe = somme des coûts calculés appel par appel (agreger.mjs) ; colonnes j… = jetons, jamais un coût
const tables = {
  // Toutes les semaines de la première à la dernière : une semaine sans réponse vaut 0 au lieu de disparaître
  semaines: semainesContinues().map(([debut, v]) => ({
    debut, cout: r2(v.cout), appels: v.appels, jetons: jetons(v), ...parGroupe(v.modeles),
    // Jetons par groupe de modèles (jopus55…), pour la vue « jetons » de la page
    ...parGroupe(v.jetonsModeles ?? {}, 'j', Math.round),
    // Semaine touchée par un trou : jours de la fenêtre (dimanche 10 h UTC → dimanche suivant) dans TROUS
    manque: [...Array(8).keys()].map(i => trou(new Date(Date.parse(debut + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10))).find(Boolean) ?? '',
  })),
  jours: joursContinus(),
  // Une ligne par jour (heure de Paris) et par dossier : la page additionne sur la période choisie (7 j, 30 j, tout ; 07/11)
  projets: Object.entries(d.jourProjet).sort().flatMap(([jour, parDossier]) => Object.entries(parDossier)
    .map(([projet, v]) => ({ jour, projet, cout: r2(v.cout), appels: v.appels, jetons: jetons(v) }))),
  types: [
    ['Lecture du cache', d.total.lectureCache, d.total.coutLecture],
    ['Écriture en cache', d.total.ecritureCache, d.total.coutEcriture],
    ['Sortie (réponses + réflexion)', d.total.sortie, d.total.coutSortie],
    ['Entrée neuve', d.total.entree, d.total.coutEntree],
  ].map(([type, jetons, cout]) => ({ type, jetons, cout: r2(cout) })),
  // Une ligne par jour (heure de Paris) et par modèle / par tranche de contexte : la page additionne sur la période (07/11)
  modeles: Object.entries(d.jourModeleTotal).sort().flatMap(([jour, parModele]) => Object.entries(parModele)
    .map(([modele, v]) => ({ jour, modele, cout: r2(v.cout), appels: v.appels, jetons: jetons(v) }))),
  contexte: Object.entries(d.jourTailles).sort().flatMap(([jour, t]) =>
    ['moins de 50k', '50k à 100k', '100k à 150k', '150k à 250k', 'plus de 250k'].map((tranche, i) => ({ jour, tranche, appels: t[i] }))),
  // Comparatif hebdo : une ligne par semaine, plafond atteint, projeté depuis un relevé, ou seulement borne basse.
  // Semaine où un reset a été utilisé : le compteur repart de zéro sans que la fin bouge, coût ÷ % n'a plus
  // de sens → pas de plafond.
  // Semaines continues (08/11) : la semaine neuve apparaît « en cours » même sans appel depuis le reset du dimanche
  plafondsHebdo: semainesContinues().map(([debut, v]) => {
    const reset = RESETS[debut];
    if (reset) return { semaine: debut, statut: `reset utilisé (${reset})`, plafond: null, sortie: null, consomme: r2(v.cout), consommeSortie: v.sortie };
    const fin = new Date(Date.parse(debut + 'T10:00:00Z') + 7 * 864e5).toISOString();
    const atteint = d.plafonds.find(p => p.type === 'hebdo' && p.reset === fin);
    const proj = d.projections.filter(p => p.type === 'hebdo' && p.debutFenetre.slice(0, 10) === debut).at(-1);
    const enCours = Date.parse(fin) > MAINTENANT;
    // Relevé à 100 % (sonar, ou relevé noté à la main quand le blocage a eu lieu hors de ce PC) : semaine pleine
    const plein = !atteint && proj?.pct >= 100;
    // Part du % consommée hors de ce PC : retirée avant de ramener le coût local à 100 %
    const hors = Math.round((atteint ? horsAvant(atteint.debutFenetre, atteint.atteinte) : proj ? proj.pct - proj.pctLocal : 0) * 10) / 10;
    const local = Math.max(0, (atteint ? 100 : proj?.pct ?? 0) - hors);
    const echelle = local >= 10 ? 100 / local : null; // sous 10 % local, la division est trop bruitée
    const pctFin = atteint ? 100 : Math.min(100, proj?.pct ?? 0), coutFin = atteint ? atteint.cout : proj?.coutAuReleve ?? 0;
    // Fourchette (13/11) : n périodes hors PC, chacune ±1 point → part locale entre local − n et local + n
    const n = atteint ? nbHorsAvant(atteint.debutFenetre, atteint.atteinte) : proj ? nbHorsAvant(proj.debutFenetre, proj.releve) : 0;
    const f = n && local >= 10 ? fourchette(coutFin, local, n) : null;
    const plafondCentral = atteint && echelle ? r2(atteint.cout * echelle) : proj && echelle ? r2(proj.coutAuReleve * echelle) : null;
    const tropLarge = f != null && plafondCentral != null && (f.max == null || f.max - f.min > LARGEUR_MAX * plafondCentral);
    const plafond = tropLarge ? null : plafondCentral;
    const note = hors ? `, dont ${String(hors).replace('.', ',')} pts hors de ce PC${f ? ` ; plafond ${tropLarge ? 'incertain : ' : ''}entre ${usd(f.min)} et ${f.max == null ? '?' : usd(f.max)}` : ''}` : '';
    // Points hors de ce PC affichés (colonne « Hors PC ») : ceux repérés période par période (13/11). L'ancienne estimation
    // globale (% − coût local ÷ prix fixe d'un point) est retirée : le prix d'un point varie beaucoup selon les semaines,
    // elle inventait du hors PC. Usage hors PC simultané à Claude Code :
    // invisible (il se fond dans le prix du point de la pente).
    // Même valeur que le statut (au dixième) : un arrondi à l'entier afficherait « ≈ 0 pts » pour 0,4 pt repéré
    const horsEstime = hors > 0 ? hors : null;
    // Projection contredite (04/11) : la semaine a consommé plus que le 100 % projeté sans l'atteindre → pas de plafond,
    // seulement « au moins le consommé »
    // Comparé au plafond central même quand il n'est pas affiché (fourchette trop large) : un dépassement reste un dépassement
    const contredit = !atteint && !plein && plafondCentral != null && v.cout > plafondCentral;
    return {
      semaine: debut,
      statut: atteint ? `atteint${note}` : plein ? `atteint (relevé à 100 %${note})` : contredit ? `${enCours ? 'en cours' : 'pas atteint'} (projection à ${proj.pct} % dépassée${note})` : proj && enCours ? `${plafond != null ? 'projeté' : 'en cours'} (${proj.pct} %${note})`
        // Semaine finie sans message de blocage ni relevé à 100 % (08/11) : le plafond reste une projection
        : proj ? `pas atteint (fini à ${proj.pct} %${plafond != null ? ', 100 % projeté' : ''}${note})` : enCours ? 'en cours' : 'pas atteint',
      pctFin: horsEstime == null ? null : pctFin, horsEstime,
      plafond: contredit ? null : plafond,
      sortie: contredit || tropLarge ? null : atteint && echelle ? Math.round(atteint.jetonsSortie * echelle) : proj && echelle ? Math.round(proj.sortieProjetee * proj.pct / 100 * echelle) : null,
      consomme: r2(v.cout),
      consommeSortie: v.sortie, // jetons de sortie de la semaine, pour la vue « jetons » de la page
    };
  }),
  plafonds5h: [
    ...d.plafonds.filter(p => p.type === '5h').map(p => ({ moment: p.atteinte.slice(0, 16), statut: 'atteint', plafond: p.cout, sortie: p.jetonsSortie })),
    // Relevés à 50 % et plus seulement : en dessous, la projection coût ÷ % est trop bruitée
    ...d.projections.filter(p => p.type === '5h' && p.pct >= 50).map(p => ({ moment: p.releve.slice(0, 16), statut: `projeté (${p.pct} %)`, plafond: p.plafondProjete, sortie: p.sortieProjetee })),
  ].sort((a, b) => a.moment < b.moment ? -1 : 1),
  // Pente : coût consommé entre deux relevés du % hebdo de la même semaine ÷ écart de % (au moins 8 points).
  // Insensible à ce qui a été consommé hors journaux AVANT le premier relevé (claude.ai, téléphone, autre PC) ;
  // une période d'usage hors de ce PC (horsJournaux) coupe la pente : on repart du relevé qui la suit.
  pentes: (() => {
    const out = [];
    for (const v of Object.values(hebdoParSemaine)) {
      let a = v[0], silence = false;
      for (const b of v.slice(1)) {
        if (b.apresCoupure) { a = b; silence = false; continue; }
        silence ||= !!b.apresSilence;
        if (b.pctLocal - a.pctLocal < 8) continue;
        out.push({ debut: a.releve.slice(0, 16), fin: b.releve.slice(0, 16), ecart: Math.round((b.pctLocal - a.pctLocal) * 10) / 10,
          heures: r2((Date.parse(b.releve) - Date.parse(a.releve)) / 36e5),
          plafond: Math.round((b.coutAuReleve - a.coutAuReleve) / (b.pctLocal - a.pctLocal) * 100), silence });
        a = b; silence = false;
      }
    }
    return out.sort((a, b) => a.debut < b.debut ? -1 : 1);
  })(),
  // Toutes les sessions (07/11) : la page filtre par période (jour de début, heure de Paris) puis garde les 30 plus chères
  sessions: d.sessions.sort((a, b) => b.cout - a.cout).map(s => ({
    session: s.id, projet: s.projet, jour: s.jour, jourFin: s.jourFin, debut: s.debut.slice(0, 16).replace('T', ' '), appels: s.appels,
    ctxMax: s.ctxMax, cout: r2(s.cout), jetons: jetons(s),
    modele: Object.entries(s.modeles).sort((a, b) => b[1] - a[1])[0][0],
  })),
};

for (const [nom, rows] of Object.entries(tables)) writeFileSync(join(sortie, `${nom}.json`), JSON.stringify(rows));
console.log(Object.entries(tables).map(([n, r]) => `${n}: ${r.length}`).join(', '), '->', sortie);
if (inconnus.size) console.log(`Info : modèle(s) hors de GROUPES, chacun en série à part sur la page : ${[...inconnus].join(', ')}`);
// Contrôles de cohérence (13/11) : n'empêchent pas l'export (code de retour 0), la ligne « CONTRÔLES : … » est à citer telle quelle
console.log(rapport(controler(d, tables, { maintenant: MAINTENANT, groupes: SERIES })));
// Garde-fou de publication (13/11) : un fichier modifié ou nouveau dans le dépôt (hors fichiers ignorés) est signalé.
// Une mise à jour des données ne doit RIEN changer dans le dépôt : pas de ligne « DÉPÔT » si tout est propre ; sinon, à citer telle quelle.
// Limites : ne regarde que le dépôt (pas un dossier de données placé ailleurs), ni les fichiers ignorés par git.
{
  const git = (...a) => execFileSync('git', ['-C', ici, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 2 ** 20 });
  const premiereLigne = e => String(e.stderr || e.message).trim().split(/\r?\n/)[0];
  let estDepot = false;
  try { estDepot = git('rev-parse', '--is-inside-work-tree').trim() === 'true'; }
  catch (e) { // copie sans .git, ou git absent : rien à vérifier ; tout autre échec est signalé
    if (e.code !== 'ENOENT' && !/not a git repository/i.test(String(e.stderr))) console.log(`DÉPÔT : contrôle impossible (${premiereLigne(e)})`);
  }
  let aUnCommit = false;
  if (estDepot) try { git('rev-parse', '--verify', '--quiet', 'HEAD'); aUnCommit = true; } catch { console.log('DÉPÔT : aucun commit encore, contrôle impossible'); }
  if (aUnCommit) try {
    // -uall : chaque fichier non suivi est listé, même si status.showUntrackedFiles=no est réglé
    const lignes = git('status', '--porcelain', '-uall').split(/\r?\n/).filter(Boolean);
    const etat = xy => xy === '??' ? 'nouveau' : xy.includes('D') ? 'supprimé' : 'modifié';
    if (lignes.length) console.log(`DÉPÔT : ${lignes.length} fichier(s) modifié(s), nouveau(x) ou supprimé(s), ne rien commiter sans relecture : ${lignes.map(l => `${l.slice(3)} (${etat(l.slice(0, 2))})`).join(', ')}`);
  } catch (e) { console.log(`DÉPÔT : contrôle impossible (${premiereLigne(e)})`); }
}
