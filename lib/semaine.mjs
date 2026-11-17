// Début de la semaine de forfait (remise à zéro hebdo) : seul module qui calcule ces dates.
// Pur : aucun fichier lu. config.mjs lit la clé remiseAZero de config.local.json et la passe ici.

// API canonique des validateurs : reglages.mjs (lireCycle et CYCLE_DEFAUT y sont déplacés ; ré-exportés ici pour les anciens imports)
export { CYCLE_DEFAUT, lireCycle } from './reglages.mjs';

const MS_JOUR = 864e5;

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
