// Durées et dates. Le cycle hebdo du forfait est en UTC (semaine.mjs) ; les jours calendaires sont en heure de Paris.
export const HEURE_MS = 36e5;
export const JOUR_MS = 864e5;
export const SEMAINE_MS = 7 * JOUR_MS;

export const iso = ms => new Date(ms).toISOString();
// Jour UTC (AAAA-MM-JJ) d'un instant
export const jourUTC = ms => iso(ms).slice(0, 10);
// Midi UTC d'un jour AAAA-MM-JJ : avancer de 24 h en 24 h depuis midi ne change jamais de date
export const midi = jour => Date.parse(jour + 'T12:00:00Z');
// Jour calendaire de Paris (AAAA-MM-JJ) d'un instant (millisecondes, texte ISO ou Date)
export const jourParis = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

const heureMinuteParis = new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// Prochain instant (ms) strictement après base où il est h:min à Paris, cherché minute par minute sur 24 h ; null sinon
export function parisVersUtc(base, h, min) {
  for (let k = 1; k <= 24 * 60; k++) {
    const t = new Date(Math.floor(base / 6e4) * 6e4 + k * 6e4);
    const p = Object.fromEntries(heureMinuteParis.formatToParts(t).map(x => [x.type, x.value]));
    if (t.getTime() > base && +p.hour === h && +p.minute === min) return t.getTime();
  }
  return null;
}
