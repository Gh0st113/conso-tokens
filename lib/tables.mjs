// Tables du tableau de bord (une par jeu de données de la page) à partir de donnees.json : des codes et des nombres,
// jamais de phrase (la page les fabrique, bloc #libelles). Pur : aucun accès disque ; `maintenant` en paramètre.
import { fabriquer } from './semaine.mjs';
import { analyserHebdo } from './hebdo.mjs';
import { jetons, CAUSES, FILS } from './agregats.mjs';
import { JOUR_MS, SEMAINE_MS, iso, jourParis, jourUTC, midi } from './temps.mjs';

const r2 = n => Math.round(n * 100) / 100;
const comparer = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Série du graphe de chaque modèle connu. Un modèle absent d'ici (ex. « Opus 4.6 ») a sa propre série, de clé
// automatique « m_opus_4-6 », que la page affiche « Opus 4.6 » : rien à changer dans la page. Fable et Mythos n'y sont
// pas : une série par version (choix de l'utilisateur, 18/11).
export const GROUPES = {
  'Opus 5.5': 'opus55', 'Opus 4.8': 'opus48',
  'Sonnet 5.5': 'sonnet', 'Sonnet 5': 'sonnet',
  'Haiku 5.5': 'haiku', 'Haiku 4.5': 'haiku',
};
export const cleAuto = modele => 'm_' + modele.toLowerCase()
  .replace(/(\d)\.(\d)/g, '$1-$2')
  .replace(/[^a-z0-9-]+/g, '_')
  .replace(/^_|_$/g, '');
// Codes de tranche de contexte et de type de jetons : le libellé est fabriqué par la page (#libelles)
const TRANCHES = ['0-50k', '50-100k', '100-150k', '150-250k', '250k+'];
const SEMAINE_VIDE = { cout: 0, appels: 0, entree: 0, ecritureCache: 0, lectureCache: 0, sortie: 0, modeles: {} };

// donnees.json d'une ancienne version d'agreger.mjs : champs par jour, jours des sessions ou segments de reset absents
export const formatAncien = donnees => !donnees.jourProjet || !donnees.jourModeleTotal || !donnees.jourTailles
  || donnees.sessions.some(s => !s.jour || !s.jourFin)
  || !donnees.segmentsHebdo || !donnees.resetsDeclares || !donnees.jourReconstructions
  || [...donnees.projections, ...donnees.plafonds].some(p => !p.debutSegment);

// Réglages : cycle (remiseAZero), resets / resetsPrecis (clé resets, deux formes), forfaits, trous (config.mjs).
// Rend les tables, les clés de série (mêmes colonnes dans chaque ligne) et les modèles hors de GROUPES.
export function construireTables(donnees, { cycle, resets, resetsPrecis, forfaits, trous, maintenant }) {
  const { debutSemaine, instantDebut } = fabriquer(cycle);
  const inconnus = new Set();
  const groupeDe = modele => {
    const groupe = GROUPES[modele];
    if (groupe) return groupe;
    inconnus.add(modele);
    return cleAuto(modele);
  };
  // Toutes les clés de série, connues et automatiques : un modèle absent d'une ligne y vaut 0
  const series = [...new Set([...Object.values(GROUPES), ...Object.keys(donnees.parModele ?? {}).map(groupeDe)])];
  // { modèle: valeur } → { préfixe + série: somme arrondie }, avec toutes les colonnes de series
  const parGroupe = (parModele, prefixe = '', arrondi = r2) => {
    const somme = Object.fromEntries(series.map(k => [k, 0]));
    for (const [modele, valeur] of Object.entries(parModele)) {
      const groupe = groupeDe(modele);
      somme[groupe] = (somme[groupe] ?? 0) + valeur;
    }
    return Object.fromEntries(Object.entries(somme).map(([k, v]) => [prefixe + k, arrondi(v)]));
  };

  // Raison du trou déclaré (clé trous) qui contient ce jour, '' sinon
  const trou = jour => trous.find(([debut, fin]) => jour >= debut && jour <= fin)?.[2] ?? '';
  // Jours de Paris d'une semaine du forfait, du jour de sa remise à zéro à celui de la suivante (inclus)
  const joursParis = debut => {
    const premier = midi(jourParis(instantDebut(debut)));
    const dernier = midi(jourParis(instantDebut(debut) + SEMAINE_MS));
    const nombre = Math.round((dernier - premier) / JOUR_MS) + 1;
    return Array.from({ length: nombre }, (_, i) => jourUTC(premier + i * JOUR_MS));
  };
  // Tous les jours du premier au dernier, même sans appel : sinon le graphe les fait disparaître. Les trous déclarés
  // comptent dans les bornes : un trou au début ou à la fin doit apparaître aussi.
  const joursContinus = () => {
    const bornes = [...Object.keys(donnees.parJour), ...trous.flatMap(([debut, fin]) => [debut, fin])].sort();
    if (!bornes.length) return [];
    const out = [];
    for (let t = midi(bornes[0]); t <= midi(bornes.at(-1)); t += JOUR_MS) {
      const jour = jourUTC(t);
      const compte = donnees.parJour[jour];
      out.push(compte
        ? { jour, cout: r2(compte.cout), appels: compte.appels, jetons: jetons(compte), manque: trou(jour) }
        : { jour, cout: 0, appels: 0, jetons: 0, manque: trou(jour) });
    }
    return out;
  };
  // Toutes les semaines de la première à celle en cours, même sans réponse encore (juste après la remise à zéro) :
  // une semaine sans réponse vaut 0 au lieu de disparaître
  const semainesContinues = () => {
    const cles = Object.keys(donnees.parSemaine).sort();
    if (!cles.length) return [];
    const fin = Math.max(midi(cles.at(-1)), midi(debutSemaine(maintenant)));
    const out = [];
    for (let t = midi(cles[0]); t <= fin; t += SEMAINE_MS) {
      const debut = jourUTC(t);
      out.push([debut, donnees.parSemaine[debut] ?? SEMAINE_VIDE]);
    }
    return out;
  };

  const semaines = semainesContinues();
  const { plafondSemaine, pentes } = analyserHebdo(donnees, { resets, forfaits, instantDebut, maintenant });
  const total = donnees.total;
  // Coût par groupe = somme des coûts calculés appel par appel (agreger.mjs) ; colonnes j… = jetons, jamais un coût.
  // Les tables par jour (heure de Paris) laissent la page additionner sur la période choisie (7 j, 30 j, tout).
  const tables = {
    semaines: semaines.map(([debut, v]) => ({
      debut, cout: r2(v.cout), appels: v.appels, jetons: jetons(v), ...parGroupe(v.modeles),
      ...parGroupe(v.jetonsModeles ?? {}, 'j', Math.round),
      // Semaine touchée par un trou : un jour de Paris de la fenêtre (d'une remise à zéro à la suivante) dans trous
      manque: joursParis(debut).map(trou).find(Boolean) ?? '',
    })),
    jours: joursContinus(),
    projets: Object.entries(donnees.jourProjet).sort().flatMap(([jour, parDossier]) => Object.entries(parDossier)
      .map(([projet, v]) => ({ jour, projet, cout: r2(v.cout), appels: v.appels, jetons: jetons(v) }))),
    types: [
      ['cacheRead', total.lectureCache, total.coutLecture],
      ['cacheWrite', total.ecritureCache, total.coutEcriture],
      ['output', total.sortie, total.coutSortie],
      ['input', total.entree, total.coutEntree],
    ].map(([type, nbJetons, cout]) => ({ type, jetons: nbJetons, cout: r2(cout) })),
    modeles: Object.entries(donnees.jourModeleTotal).sort().flatMap(([jour, parModele]) => Object.entries(parModele)
      .map(([modele, v]) => ({ jour, modele, cout: r2(v.cout), appels: v.appels, jetons: jetons(v) }))),
    contexte: Object.entries(donnees.jourTailles).sort()
      .flatMap(([jour, t]) => TRANCHES.map((tranche, i) => ({ jour, tranche, appels: t[i] }))),
    plafondsHebdo: semaines.map(([debut, v]) => plafondSemaine(debut, v)),
    plafonds5h: [
      ...donnees.plafonds.filter(p => p.type === '5h')
        .map(p => ({
          moment: p.atteinte.slice(0, 16), etat: 'atteint', pct: null, plafond: p.cout, sortie: p.jetonsSortie,
        })),
      // Relevés à 50 % et plus seulement : en dessous, la projection coût ÷ % est trop bruitée
      ...donnees.projections.filter(p => p.type === '5h' && p.pct >= 50).map(p => ({
        moment: p.releve.slice(0, 16), etat: 'projete', pct: p.pct, plafond: p.plafondProjete, sortie: p.sortieProjetee,
      })),
    ].sort((a, b) => a.moment < b.moment ? -1 : 1),
    pentes,
    // Toutes les sessions : la page filtre par période (jour de début, heure de Paris) puis garde les 30 plus chères
    sessions: [...donnees.sessions].sort((a, b) => b.cout - a.cout).map(s => ({
      session: s.id, projet: s.projet, jour: s.jour, jourFin: s.jourFin, debut: s.debut.slice(0, 16).replace('T', ' '),
      appels: s.appels, ctxMax: s.ctxMax, cout: r2(s.cout), jetons: jetons(s),
      // Modèle principal : celui qui a donné le plus de réponses
      modele: Object.entries(s.modeles).sort((a, b) => b[1] - a[1])[0][0],
    })),
    // Une seule ligne, valable pour tout le tableau : jour et heure UTC de la remise à zéro
    reglages: [{ jour: cycle.jour, jourNum: cycle.jourNum, heureUTC: cycle.heureUTC, fuseau: 'UTC' }],
    // Resets déclarés, des deux formes. Ancienne forme : quand vide. Nouvelle : « AAAA-MM-JJTHH:MM » UTC sans Z, comme
    // les autres tables.
    resets: [
      ...Object.entries(resets).map(([semaine, note]) => ({ quand: '', type: 'hebdo', note: String(note), semaine })),
      ...resetsPrecis.map(p => ({ quand: iso(p.quand).slice(0, 16), type: p.type, note: p.note, semaine: p.semaine })),
    ].sort((a, b) => comparer(a.semaine, b.semaine) || comparer(a.quand, b.quand)),
    // Reconstructions du cache (agregats.mjs) par jour de Paris et par fil (principal, sousAgent) : une ligne « total »
    // (toute l'écriture cache de ce fil ce jour-là, le dénominateur de la part), puis une par cause présente
    reconstructions: Object.entries(donnees.jourReconstructions).sort().flatMap(([jour, parFil]) => FILS
      .filter(fil => parFil[fil]).flatMap(fil => ['total', ...CAUSES]
        .filter(cause => cause === 'total' || parFil[fil][cause].nombre)
        .map(cause => ({ jour, fil, cause, nombre: parFil[fil][cause].nombre, jetons: parFil[fil][cause].jetons,
          cout: r2(parFil[fil][cause].cout) })))),
    // Forfaits déclarés, triés par date ; sans clé forfaits : liste vide
    forfaits: forfaits.map(f => ({ date: f.date, semaine: f.semaine, forfait: f.forfait, changement: f.changement })),
  };
  return { tables, series, inconnus: [...inconnus] };
}
