// Validateurs des réglages propres à chaque utilisateur (config.local.json) : un seul module, API canonique (15/11).
// Pur : aucun import, aucun fichier lu. config.mjs est le seul lecteur du fichier : il ajoute le préfixe « config.local.json : ».
// Cycle (clé remiseAZero) : un jour de la semaine et une heure UTC ; défaut : dimanche 10:00 UTC (comportement d'origine).

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// Noms acceptés (français et anglais), comparés sans tenir compte de la casse
const NOMS = new Map([
  ...JOURS.map((j, i) => [j, i]),
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6],
]);
export const CYCLE_DEFAUT = { jour: 'dimanche', jourNum: 0, heureUTC: '10:00' };

// Valide et normalise la clé remiseAZero : undefined → défaut ; sinon { jour, jourNum, heureUTC } ou une Error simple
export function lireCycle(valeur) {
  if (valeur === undefined) return { ...CYCLE_DEFAUT };
  if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur))
    throw new Error('doit être un objet { "jour": "dimanche", "heureUTC": "10:00" }');
  const jourNum = typeof valeur.jour === 'string' ? NOMS.get(valeur.jour.trim().toLowerCase()) : undefined;
  if (jourNum === undefined)
    throw new Error(`« jour » doit être un jour de la semaine (ex. "dimanche" ou "sunday"), reçu ${JSON.stringify(valeur.jour)}`);
  const m = typeof valeur.heureUTC === 'string' ? valeur.heureUTC.match(/^(\d{2}):(\d{2})$/) : null;
  if (!m || +m[1] > 23 || +m[2] > 59)
    throw new Error(`« heureUTC » doit être une heure HH:MM entre 00:00 et 23:59 (ex. "10:00"), reçu ${JSON.stringify(valeur.heureUTC)}`);
  return { jour: JOURS[jourNum], jourNum, heureUTC: `${m[1]}:${m[2]}` };
}

// Resets de la limite hebdo (clé resets), deux formes, l'une OU l'autre :
//  - ancienne : objet { "AAAA-MM-JJ": "quand" } → semaine entière « reset utilisé (…) », plafond nul (comportement d'origine) ;
//  - nouvelle : liste [{ "quand": "AAAA-MM-JJTHH:MMZ", "type": "hebdo", "note": "texte facultatif" }] → la semaine est découpée.
// debutSemaine : même fonction que celle de l'export (fabriquer(cycle).debutSemaine), pour ranger chaque reset dans sa semaine.
// Rend { semaines: { 'AAAA-MM-JJ': 'quand' }, precis: [{ quand: ms, type, note, semaine }] } ; la nouvelle forme ne remplit
// jamais `semaines` (sinon l'export marquerait la semaine entière comme perdue et annulerait le découpage).
const TYPES_RESET = ['hebdo'];
const CHAMPS_RESET = ['quand', 'type', 'note'];
const FORME_QUAND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/; // UTC, Z obligatoire, secondes refusées
export function lireResets(valeur, debutSemaine) {
  if (valeur === undefined) return { semaines: {}, precis: [] };
  if (Array.isArray(valeur)) {
    const vus = new Set(), precis = [];
    valeur.forEach((r, i) => {
      const ou = `[${i}]`;
      if (r === null || typeof r !== 'object' || Array.isArray(r))
        throw new Error(`${ou} doit être un objet { "quand": "AAAA-MM-JJTHH:MMZ", "type": "hebdo" }`);
      const inconnu = Object.keys(r).find(k => !CHAMPS_RESET.includes(k));
      if (inconnu !== undefined) throw new Error(`${ou} : champ inconnu « ${inconnu} » (champs acceptés : quand, type, note)`);
      const ms = typeof r.quand === 'string' && FORME_QUAND.test(r.quand) ? Date.parse(r.quand) : NaN;
      if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 16) !== r.quand.slice(0, 16))
        throw new Error(`${ou} « quand » doit être une date UTC AAAA-MM-JJTHH:MMZ (ex. "2026-11-03T21:00Z"), reçu ${JSON.stringify(r.quand)}`);
      if (!TYPES_RESET.includes(r.type))
        throw new Error(`${ou} « type » doit être "hebdo" (seul type accepté pour l'instant), reçu ${JSON.stringify(r.type)}`);
      if (r.note !== undefined && typeof r.note !== 'string') throw new Error(`${ou} « note » doit être un texte`);
      if (vus.has(r.quand)) throw new Error(`${ou} : « quand » ${r.quand} est déjà déclaré (doublon)`);
      vus.add(r.quand);
      precis.push({ quand: ms, type: r.type, note: r.note ?? '', semaine: debutSemaine(ms) });
    });
    return { semaines: {}, precis };
  }
  if (valeur === null || typeof valeur !== 'object')
    throw new Error('doit être une liste [ … ] ou un objet { "AAAA-MM-JJ": "quand" }');
  return { semaines: { ...valeur }, precis: [] };
}

// Forfaits déclarés à la main (clé forfaits, 15/11) : { "AAAA-MM-JJ": "libellé" } = ce forfait à partir de la semaine qui
// contient cette date. Libellé = texte libre, espaces de bord retirés, alphabet restreint (pas de parenthèse ni de % : elles
// fausseraient les expressions de controles.mjs qui lisent le statut). Rend la liste triée par date :
// [{ date, semaine, forfait, changement }], changement = vrai si le libellé diffère du précédent (sans tenir compte de la casse).
// debutSemaine : même fonction que l'export. Semaine d'une date = l'instant de remise à zéro de ce jour-là : le jour de la
// remise à zéro tombe dans la nouvelle semaine, quelle que soit l'heure du cycle.
const FORME_DATE_FORFAIT = /^\d{4}-\d{2}-\d{2}$/;
const FORME_LIBELLE = /^[\p{L}\p{N} .+-]+$/u;
export function lireForfaits(valeur, cycle, debutSemaine) {
  if (valeur === undefined) return [];
  if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur))
    throw new Error('doit être un objet { "AAAA-MM-JJ": "libellé" }, par exemple { "2026-01-04": "Pro" }');
  const entrees = Object.entries(valeur).map(([date, libelle]) => {
    const ms = FORME_DATE_FORFAIT.test(date) ? Date.parse(date + 'T12:00:00Z') : NaN;
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date)
      throw new Error(`date ${JSON.stringify(date)} illisible ou impossible (format AAAA-MM-JJ, ex. "2026-01-04")`);
    if (typeof libelle !== 'string') throw new Error(`« ${date} » : le libellé doit être un texte, reçu ${JSON.stringify(libelle)}`);
    const forfait = libelle.trim();
    if (!forfait) throw new Error(`« ${date} » : libellé vide`);
    if ([...forfait].length > 40) throw new Error(`« ${date} » : libellé de plus de 40 caractères`);
    if (!FORME_LIBELLE.test(forfait))
      throw new Error(`« ${date} » : libellé « ${forfait} » hors de l'alphabet (lettres, chiffres, espace, . + - ; ni parenthèse ni %)`);
    return { date, semaine: debutSemaine(Date.parse(`${date}T${cycle.heureUTC}:00Z`)), forfait };
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  entrees.forEach((e, i) => {
    if (i && e.semaine === entrees[i - 1].semaine)
      throw new Error(`« ${entrees[i - 1].date} » et « ${e.date} » tombent dans la même semaine (ambigu : n'en garder qu'une)`);
  });
  return entrees.map((e, i) => ({ ...e, changement: i > 0 && e.forfait.toLowerCase() !== entrees[i - 1].forfait.toLowerCase() }));
}
