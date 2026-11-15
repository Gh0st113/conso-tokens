// Début de la semaine de forfait (remise à zéro hebdo) : seul module qui calcule ces dates.
// Pur : aucun import, aucune lecture de fichier. config.mjs lit la clé remiseAZero de config.local.json et la passe ici.
// Cycle = un jour de la semaine et une heure UTC ; défaut : dimanche 10:00 UTC (comportement d'origine).

const MS_JOUR = 864e5;
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
  const m = typeof valeur.heureUTC === 'string' ? valeur.heureUTC.trim().match(/^(\d{2}):(\d{2})$/) : null;
  if (!m || +m[1] > 23 || +m[2] > 59)
    throw new Error(`« heureUTC » doit être une heure HH:MM entre 00:00 et 23:59 (ex. "10:00"), reçu ${JSON.stringify(valeur.heureUTC)}`);
  return { jour: JOURS[jourNum], jourNum, heureUTC: `${m[1].padStart(2, '0')}:${m[2]}` };
}

// Fonctions du cycle (cycle = résultat de lireCycle)
export function fabriquer(cycle) {
  const { jourNum, heureUTC } = cycle;
  const [h, min] = heureUTC.split(':').map(Number);
  const decalage = (h * 60 + min) * 60e3;
  // « AAAA-MM-JJ » (date UTC) du jour qui ouvre la fenêtre contenant ts (ts : texte ISO ou millisecondes)
  const debutSemaine = ts => {
    const d = new Date(ts), t = d.getTime();
    const jourUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    let debut = jourUTC - ((d.getUTCDay() - jourNum + 7) % 7) * MS_JOUR + decalage;
    if (debut > t) debut -= 7 * MS_JOUR;
    return new Date(debut).toISOString().slice(0, 10);
  };
  // Millisecondes de l'instant de remise à zéro du jour « AAAA-MM-JJ »
  const instantDebut = jour => Date.parse(`${jour}T${heureUTC}:00Z`);
  return { debutSemaine, instantDebut };
}
