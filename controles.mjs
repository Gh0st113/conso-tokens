// Contrôles de cohérence des tables exportées (13/11) : appelés en fin d'exporter.mjs, testés par controles.test.mjs.
// But : donner à la session Haiku de mise à jour un signal net (« CONTRÔLES : OK » ou une liste précise) au lieu de lui
// laisser juger des chiffres, et rendre une session de correction courte (l'anomalie arrive déjà décrite).
// Deux niveaux :
//   anomalie   = incohérence certaine (un calcul ou une donnée est faux) → à corriger dans agreger/exporter ;
//   aVerifier  = valeur peu plausible ou relevés manquants → peut être vraie, à regarder avant de s'y fier.
// Fonction pure : aucune écriture, aucun accès disque ; `maintenant` en paramètre pour les tests.
import { fabriquer, CYCLE_DEFAUT } from './semaine.mjs';

// Champs qui ont le droit d'être null (estimation impossible) ; tout autre nombre doit être fini
const NULLS_PERMIS = new Set(['plafond', 'sortie', 'pctFin', 'horsEstime']);
// Plausibilité d'un plafond hebdo ou d'une pente ($ pour 100 %) : entre la moitié et le double de la médiane des pentes
// sans silence ; seulement sur les 2 dernières semaines (l'historique peut avoir des cas connus et expliqués)
const BANDE = [0.5, 2];
const SONAR_MUET_H = 24; // dernier relevé hebdo plus vieux que ça alors que ce PC a consommé aujourd'hui

const somme = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
// Tolérance d'une somme de valeurs arrondies au centime : un demi-centime par ligne, plus 2 centimes
const tol = n => n * 0.005 + 0.02;
const fr = n => String(Math.round(n * 100) / 100).replace('.', ',');
const medianne = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null; };
// « AAAA-MM-JJTHH:MM » de l'export = UTC sans « Z » ; une date déjà complète est lue telle quelle
const dateUTC = s => Date.parse(/T\d\d:\d\d$/.test(s) ? s + ':00Z' : s);
const jourParis = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(t);
// « JJ/MM HH:MM » UTC d'un instant ISO
const jjmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
// Suffixe du statut d'une semaine coupée, écrit par exporter.mjs et relu par segmentRetenu ci-dessous : un seul endroit
// pour le format, protégé par un test aller-retour (controles.test.mjs)
export const suffixeCoupee = (premierISO, debutSegmentISO) =>
  ` ; coupée par reset hebdo le ${jjmm(premierISO)} UTC (segment retenu : depuis le ${jjmm(debutSegmentISO)})`;
// Segment retenu d'une semaine coupée (suffixe « segment retenu : depuis le JJ/MM HH:MM » du statut) : entrée de segmentsHebdo, ou null
const segmentRetenu = (d, r) => {
  const m = r.statut.match(/segment retenu : depuis le (\d\d\/\d\d \d\d:\d\d)\)/);
  if (!m) return null;
  return (d.segmentsHebdo ?? []).find(s => s.semaine === r.semaine && jjmm(s.debut) === m[1]) ?? null;
};

// Forfait d'une semaine (clé forfaits, 15/11) : libellé de la dernière entrée dont la semaine est ≤ celle-ci, « » si aucune
// (inconnu). entrees = table « forfaits » (triée par date). Même règle que forfaitDe dans page/index.html (la page ne peut
// pas importer ce module) : un test de controles.test.mjs les garde d'accord.
export const forfaitDe = (entrees, semaine) => entrees.reduce((f, e) => e.semaine <= semaine ? e.forfait : f, '');
// Suffixe du statut d'une semaine de changement de forfait (écrit par exporter.mjs, contrôlé ici)
export const SUFFIXE_INDICATIF = 'plafond indicatif : mêle deux forfaits';

// `debutSemaine` : même fonction que celle de l'export (exporter.mjs) ; par défaut, cycle de config par défaut
export function controler(d, tables, { maintenant = Date.now(), groupes = [], debutSemaine = fabriquer(CYCLE_DEFAUT).debutSemaine } = {}) {
  const anomalies = [], aVerifier = [];
  const t = d.total ?? {}, total = t.cout;
  // Sans total valide, toutes les comparaisons de sommes seraient silencieuses (NaN > x vaut faux)
  if (!Number.isFinite(total)) return { anomalies: [`total.cout de donnees.json = ${total} : contrôles des sommes impossibles`], aVerifier };
  for (const k of ['appels', 'entree', 'ecritureCache', 'lectureCache', 'sortie'])
    if (!Number.isFinite(t[k])) anomalies.push(`total.${k} de donnees.json = ${t[k]} : contrôles des appels et jetons faussés`);

  // 1. Valeurs : ni NaN, ni Infinity, ni null hors des champs d'estimation ; compteurs jamais négatifs
  for (const [nom, rows] of Object.entries(tables)) {
    rows.forEach((r, i) => {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'number' && !Number.isFinite(v)) anomalies.push(`${nom}[${i}].${k} = ${v} (pas un nombre)`);
        if (v === null && !NULLS_PERMIS.has(k)) anomalies.push(`${nom}[${i}].${k} = null (champ non estimé)`);
        if (['cout', 'appels', 'jetons', 'consomme'].includes(k) && typeof v === 'number' && v < 0) anomalies.push(`${nom}[${i}].${k} = ${v} (négatif)`);
      }
    });
  }

  // 2. Chaque table qui découpe le total doit retomber sur le même total : coût, appels, jetons
  const tTotal = { cout: total, appels: t.appels, jetons: t.entree + t.ecritureCache + t.lectureCache + t.sortie };
  const DECOUPES = { jours: ['cout', 'appels', 'jetons'], semaines: ['cout', 'appels', 'jetons'], projets: ['cout', 'appels', 'jetons'],
    modeles: ['cout', 'appels', 'jetons'], sessions: ['cout', 'appels', 'jetons'], types: ['cout', 'jetons'], contexte: ['appels'] };
  for (const [nom, champs] of Object.entries(DECOUPES)) {
    const rows = tables[nom] ?? [];
    for (const k of champs) {
      const manquants = rows.filter(r => typeof r[k] !== 'number').length;
      if (manquants) { anomalies.push(`« ${nom} » : ${manquants} ligne(s) sans ${k} numérique`); continue; }
      const s = somme(rows, k), ecart = Math.abs(s - tTotal[k]);
      // Coûts arrondis au centime : un demi-centime par ligne ; appels et jetons sont des entiers exacts
      if (k === 'cout' ? ecart > tol(rows.length) : ecart > 0) anomalies.push(`somme ${k} de « ${nom} » = ${k === 'cout' ? fr(s) + ' $' : s} ≠ total ${k === 'cout' ? fr(tTotal[k]) + ' $' : tTotal[k]}`);
    }
  }

  // 3. Par semaine : les colonnes de groupes de modèles (coût et jetons) retombent sur la semaine
  for (const r of tables.semaines ?? []) {
    const sc = groupes.reduce((s, g) => s + (r[g] ?? 0), 0), sj = groupes.reduce((s, g) => s + (r['j' + g] ?? 0), 0);
    if (Math.abs(sc - r.cout) > tol(groupes.length)) anomalies.push(`semaine ${r.debut} : groupes = ${fr(sc)} $ ≠ coût ${fr(r.cout)} $`);
    if (Math.abs(sj - r.jetons) > groupes.length) anomalies.push(`semaine ${r.debut} : jetons des groupes = ${sj} ≠ ${r.jetons}`);
  }

  // 4. Modèles : sans tarif (coût compté 0 $). Un modèle sans groupe a sa propre série depuis le 13/11 : plus une anomalie
  for (const [m, v] of Object.entries(d.parModele ?? {})) {
    if (!d.tarifs?.[m]) anomalies.push(`modèle « ${m} » sans tarif dans agreger.mjs (coût compté 0 $)`);
    else if (v.appels > 0 && !(v.cout > 0)) anomalies.push(`modèle « ${m} » : ${v.appels} appels pour ${v.cout} $ (tarif nul ou mal lu)`);
  }

  // 5. Comparatif hebdo : mêmes semaines que « semaines », même consommé, statut d'accord avec ses colonnes
  // Semaines de changement de forfait (table « forfaits », 15/11) : leur plafond est indicatif, leurs pentes sont exclues du contrôle 6
  const entrees = tables.forfaits ?? [], chg = new Set(entrees.filter(e => e.changement).map(e => e.semaine));
  const hebdo = tables.plafondsHebdo ?? [], parDebut = new Map((tables.semaines ?? []).map(s => [s.debut, s]));
  const sH = hebdo.map(r => r.semaine).join(), sS = [...parDebut.keys()].join();
  if (sH !== sS) anomalies.push(`semaines du comparatif hebdo (${hebdo.length}) ≠ semaines de « semaines » (${parDebut.size})`);
  for (const r of hebdo) {
    if (typeof r.statut !== 'string') { anomalies.push(`semaine ${r.semaine} : statut absent`); continue; }
    // Suffixe « indicatif » : celui des semaines de changement de forfait, et seulement celles-là (15/11)
    const indicatif = r.statut.includes(SUFFIXE_INDICATIF);
    if (chg.has(r.semaine) && !indicatif) anomalies.push(`semaine ${r.semaine} : changement de forfait sans suffixe « ${SUFFIXE_INDICATIF} »`);
    if (!chg.has(r.semaine) && indicatif) anomalies.push(`semaine ${r.semaine} : suffixe « ${SUFFIXE_INDICATIF} » hors d'une semaine de changement`);
    const s = parDebut.get(r.semaine);
    if (s && Math.abs(s.cout - r.consomme) > 0.01) anomalies.push(`semaine ${r.semaine} : consommé ${fr(r.consomme)} $ ≠ coût de la semaine ${fr(s.cout)} $`);
    const m = r.statut.match(/dont ([\d,]+) pts hors de ce PC/);
    const lu = m ? Number(m[1].replace(',', '.')) : null;
    if (lu !== (r.horsEstime ?? null)) anomalies.push(`semaine ${r.semaine} : statut dit ${lu ?? 'aucun'} pts hors PC, colonne horsEstime = ${r.horsEstime}`);
    if (r.horsEstime != null && r.pctFin != null && r.horsEstime > r.pctFin) anomalies.push(`semaine ${r.semaine} : ${fr(r.horsEstime)} pts hors PC > ${r.pctFin} % atteints`);
    const pm = r.statut.match(/\((\d+) %/);
    if (pm && r.pctFin != null && Number(pm[1]) !== r.pctFin && !r.statut.startsWith('atteint')) anomalies.push(`semaine ${r.semaine} : statut dit ${pm[1]} %, colonne pctFin = ${r.pctFin}`);
    // Un plafond affiché doit couvrir ce que la semaine a déjà coûté (sinon la projection est contredite).
    // Semaine coupée par un reset précis (15/11) : on compare au coût du segment retenu (segmentsHebdo), pas à la semaine
    const coupee = /coupée par reset hebdo/.test(r.statut), seg = segmentRetenu(d, r);
    if (coupee && !seg) anomalies.push(`semaine ${r.semaine} : segment retenu absent de segmentsHebdo`);
    const coutRef = coupee && seg ? seg.cout : r.consomme;
    if (r.plafond != null && !r.statut.startsWith('atteint') && coutRef > r.plafond + 0.01) anomalies.push(`semaine ${r.semaine} : consommé ${fr(coutRef)} $ > plafond ${fr(r.plafond)} $ sans statut « dépassée »`);
  }
  const debutCourante = debutSemaine(maintenant);
  // Export vide (installation neuve) : rien à comparer
  if (hebdo.length && hebdo.at(-1).semaine !== debutCourante) anomalies.push(`dernière semaine du comparatif = ${hebdo.at(-1).semaine}, semaine en cours = ${debutCourante}`);

  // 6. Plausibilité (2 dernières semaines seulement) : plafonds et pentes dans la bande autour de la médiane des pentes
  const pentes = tables.pentes ?? [];
  pentes.forEach((p, i) => { if (!(p.ecart >= 8) || !(p.heures > 0) || !(p.plafond > 0)) anomalies.push(`pentes[${i}] (${p.debut}) : écart ${p.ecart}, ${p.heures} h, ${p.plafond} $ (attendu : écart ≥ 8, durée et plafond > 0)`); });
  // Médiane PAR FORFAIT (15/11) : pentes sans silence, hors semaines de changement. Sans table « forfaits », un seul groupe (« ») : comme avant
  const parForfait = new Map();
  for (const p of pentes) {
    const sem = debutSemaine(dateUTC(p.debut)), f = forfaitDe(entrees, sem);
    // Clé sans casse : « Pro » puis « pro » (même forfait, pas de changement) forment un seul groupe (relecture DeepSeek, 16/11)
    const cle = f.toLowerCase();
    if (!p.silence && !chg.has(sem)) parForfait.set(cle, [...(parForfait.get(cle) ?? []), p.plafond]);
  }
  const recent = Date.parse(debutCourante) - 7 * 864e5;
  const hors = (v, quoi, f) => {
    const med = medianne(parForfait.get(f.toLowerCase()) ?? []);
    if (!med) return; // aucune pente de ce forfait : pas de contrôle pour lui
    const [bas, haut] = BANDE.map(k => k * med), nom = f ? ` du forfait « ${f} »` : '';
    if (v < bas || v > haut) aVerifier.push(`${quoi} = ${Math.round(v)} $, loin de la médiane des pentes${nom} (${Math.round(med)} $ ; plage plausible ${Math.round(bas)} à ${Math.round(haut)} $)`);
  };
  for (const r of hebdo) if (Date.parse(r.semaine) >= recent && r.plafond != null && !chg.has(r.semaine)) hors(r.plafond, `plafond de la semaine ${r.semaine}`, forfaitDe(entrees, r.semaine));
  for (const p of pentes) {
    const sem = debutSemaine(dateUTC(p.debut));
    if (dateUTC(p.debut) >= recent && !chg.has(sem)) hors(p.plafond, `pente ${p.debut} → ${p.fin}${p.silence ? ' (silence)' : ''}`, forfaitDe(entrees, sem));
  }

  // 7. Fraîcheur : relevé hebdo (sonar) récent si ce PC a consommé aujourd'hui. Pas d'alerte « jour sans données » :
  // un jour sans usage est normal et ferait du bruit (relecture du 13/11).
  const jours = tables.jours ?? [], dernier = jours.at(-1), auj = jourParis(maintenant);
  const releves = (d.projections ?? []).filter(p => p.type === 'hebdo').map(p => Date.parse(p.releve)).sort((a, b) => a - b);
  // Aucun relevé du tout (pas de sonar ni d'événement de limite) : rien à surveiller, pas d'alerte
  const age = releves.length ? (maintenant - releves.at(-1)) / 36e5 : null;
  if (age != null && dernier?.jour === auj && dernier.cout > 0 && age > SONAR_MUET_H) aVerifier.push(`dernier relevé du % hebdo il y a ${Math.round(age)} h alors que ce PC a consommé aujourd'hui : sonar muet ?`);

  // 8. Reset non déclaré (15/11) : par fenêtre hebdo (debutFenetre), relevés triés par heure. Une baisse est probable entre a et b
  // quand b ≤ plus haut des relevés précédents − 3 points ET le relevé suivant c aussi (baisse confirmée : une ligne isolée
  // n'est pas un reset). Pas de signal si un reset déclaré tombe dans ]a, c], ou si la semaine est déclarée à l'ancienne forme.
  // Un seul signal par fenêtre, jamais de correction. Sans resetsDeclares (donnees.json ancien) : rien n'est déclaré.
  const declares = d.resetsDeclares ?? { semaines: {}, precis: [] };
  const parFenetre = {};
  for (const p of (d.projections ?? []).filter(p => p.type === 'hebdo')) (parFenetre[p.debutFenetre] ??= []).push(p);
  for (const v of Object.values(parFenetre)) {
    v.sort((x, y) => x.releve < y.releve ? -1 : 1);
    const semaine = v[0].debutFenetre.slice(0, 10);
    // Semaine de changement de forfait sautée (15/11) : la baisse du % vient du changement, comme une semaine à l'ancienne forme
    if (declares.semaines?.[semaine] !== undefined || chg.has(semaine)) continue;
    for (let i = 1; i < v.length - 1; i++) {
      const [a, b, c] = [v[i - 1], v[i], v[i + 1]], ta = Date.parse(a.releve), tb = Date.parse(b.releve), tc = Date.parse(c.releve);
      // Maximum pris dans le segment de b seulement (décision 5 corrigée, 15/11) : un reset précis déclaré avant b remet le
      // maximum à zéro pour les relevés qui le suivent. Début du segment = dernier reset déclaré de la semaine ≤ b.
      const debutSegment = Math.max(-Infinity, ...declares.precis.filter(p => p.semaine === semaine).map(p => Date.parse(p.quand)).filter(t => t <= tb));
      const avant = v.slice(0, i).filter(p => Date.parse(p.releve) >= debutSegment);
      if (!avant.length) continue;
      const max = Math.max(...avant.map(p => p.pct));
      if (!(b.pct <= max - 3 && c.pct <= max - 3)) continue;
      // Reset déclaré dans ]a, c] : la baisse de b ou la confirmation par c s'explique par ce reset (relecture 1, 16/11)
      if (declares.precis.some(p => { const t = Date.parse(p.quand); return t > ta && t <= tc; })) continue;
      aVerifier.push(`reset probable entre le ${jjmm(a.releve)} et le ${jjmm(b.releve)} UTC (semaine du ${semaine}), non déclaré dans « resets »`);
      break;
    }
  }

  return { anomalies, aVerifier };
}

// Texte à afficher, une ligne d'en-tête lisible telle quelle par la session Haiku
export function rapport({ anomalies, aVerifier }) {
  if (!anomalies.length && !aVerifier.length) return 'CONTRÔLES : OK';
  return [`CONTRÔLES : ${anomalies.length} anomalie(s), ${aVerifier.length} à vérifier`,
    ...anomalies.map(a => `  ANOMALIE : ${a}`), ...aVerifier.map(a => `  À VÉRIFIER : ${a}`)].join('\n');
}
