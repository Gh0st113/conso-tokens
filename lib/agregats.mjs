// Calcul de donnees.json à partir des réponses, limites et relevés déjà lus (lecture.mjs). Pur : aucun accès disque.
import { fabriquer } from './semaine.mjs';
import { couts } from './tarifs.mjs';
import { HEURE_MS, JOUR_MS, SEMAINE_MS, iso, jourParis, parisVersUtc } from './temps.mjs';

const r2 = n => Math.round(n * 100) / 100;
export const jetons = v => v.entree + v.ecritureCache + v.lectureCache + v.sortie;
const CUMULS = ['entree', 'ecritureCache', 'lectureCache', 'sortie', 'reflexion',
  'cout', 'coutEntree', 'coutEcriture', 'coutLecture', 'coutSortie'];
const vide = () => ({ ...Object.fromEntries(CUMULS.map(k => [k, 0])), appels: 0 });
const ajouter = (total, appel) => {
  for (const k of CUMULS) total[k] += appel[k];
  total.appels++;
};
// Taille du contexte d'une réponse : < 50k, 50-100k, 100-150k, 150-250k, > 250k
const SEUILS_CONTEXTE = [50e3, 100e3, 150e3, 250e3];
const trancheDe = contexte => {
  const i = SEUILS_CONTEXTE.findIndex(s => contexte < s);
  return i === -1 ? SEUILS_CONTEXTE.length : i;
};
// Le % sous 10 rend la division coût ÷ % trop bruitée : un tel relevé ne sert pas aux plafonds
const PCT_MIN = 10;
const parDate = (a, b) => a.ts < b.ts ? -1 : 1;

// Reconstruction du cache (24/11) : réponse qui relit en cache moins de la moitié du contexte de la réponse précédente
// de son fil, et qui écrit au moins ecritureMin (clé cache) : le cache a été perdu et le contexte réécrit, au prix de
// l'écriture. Un fil = la conversation principale d'une session, ou un sous-agent (champ agent) : chacun a son propre
// cache. Cause, dans cet ordre : compactage entre les deux réponses (conversation principale seulement) ; pause plus
// longue que la durée du cache ; changement de modèle ; autre. Durée du cache (ttl « auto ») : celle de la dernière
// écriture du fil, 5 min si elle mêle 5 min et 1 h, 5 min si le fil n'a encore rien écrit ; « 5m » ou « 1h » la forcent.
// Sous-agent sans champ agent (journal disparu avant le 24/11) : compté au total, pas analysé.
export const PART_LUE = 0.5;
export const CAUSES = ['compactage', 'pause', 'modele', 'autre'];
export const FILS = ['principal', 'sousAgent'];
const CACHE_PAR_DEFAUT = { principal: { ttl: 'auto', ecritureMin: 20000 }, sousAgent: { ttl: 'auto', ecritureMin: 10000 } };
const CINQ_MIN = 5 * 60e3;
const TTL_FORCE = { '5m': CINQ_MIN, '1h': HEURE_MS };
const contexteDe = a => a.entree + a.ecritureCache + a.lectureCache;
const grouper = (liste, cle) => {
  const m = new Map();
  for (const x of liste) {
    const k = cle(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
// reponses : avec leurs coûts (couts) ; compactages : { ts, session, … } ; cache : clé cache lue (lireCache). Rend
// { jour de Paris: { principal | sousAgent: { total, compactage, pause, modele, autre } } }, chacun { nombre, jetons
// (écrits en cache), cout (de cette écriture) } ; total = toutes les réponses du jour de ce type de fil.
export function reconstructions(reponses, compactages, cache = CACHE_PAR_DEFAUT) {
  const parJour = {};
  const vide = () => Object.fromEntries(['total', ...CAUSES].map(c => [c, { nombre: 0, jetons: 0, cout: 0 }]));
  const compter = (jour, type, cle, a) => {
    const l = ((parJour[jour] ??= {})[type] ??= vide())[cle];
    l.nombre++;
    l.jetons += a.ecritureCache;
    l.cout += a.coutEcriture;
  };
  const compacts = grouper(compactages, c => c.session);
  for (const a of reponses) compter(jourParis(a.ts), a.sousAgent ? 'sousAgent' : 'principal', 'total', a);
  const analysables = reponses.filter(a => !a.sousAgent || a.agent);
  const fils = grouper(analysables, a => a.sousAgent ? `${a.session}/${a.agent}` : a.session);
  for (const liste of fils.values()) {
    const type = liste[0].sousAgent ? 'sousAgent' : 'principal';
    const { ttl, ecritureMin } = cache[type];
    // Étape du conseiller : même heure que sa réponse ; seule celle au plus grand contexte suit le fil
    const parHeure = new Map();
    for (const a of liste) {
      const p = parHeure.get(a.ts);
      if (!p || contexteDe(a) > contexteDe(p)) parHeure.set(a.ts, a);
    }
    const fil = [...parHeure.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const instants = type === 'principal' ? (compacts.get(liste[0].session) ?? []).map(c => Date.parse(c.ts)) : [];
    let duree = CINQ_MIN; // durée de la dernière écriture du fil (ttl « auto »)
    fil.forEach((a, i) => {
      const prec = fil[i - 1];
      if (prec && a.ecritureCache >= ecritureMin && a.lectureCache < PART_LUE * contexteDe(prec)) {
        const t0 = Date.parse(prec.ts), t1 = Date.parse(a.ts);
        const cause = instants.some(t => t > t0 && t <= t1) ? 'compactage'
          : t1 - t0 > (TTL_FORCE[ttl] ?? duree) ? 'pause'
            : a.modele !== prec.modele ? 'modele' : 'autre';
        compter(jourParis(a.ts), type, cause, a);
      }
      if (a.ecriture5m > 0) duree = CINQ_MIN;
      else if (a.ecriture1h > 0) duree = HEURE_MS;
    });
  }
  return parJour;
}

// appels, limites, compactages : valeurs des Map de l'archive ; releves : relevés de toutes les sources, au format de
// releves.json. cycle : remise à zéro hebdo ; resets, resetsPrecis : clé resets de config.local.json (deux formes) ;
// cache : clé cache (lireCache), défaut si absente.
// Rend les champs de donnees.json à partir de total, et sansTarif (modèles comptés à 0 $).
export function agreger({ appels, limites, compactages = [], releves, tarifs, paliers, cycle, resets, resetsPrecis, cache }) {
  const { debutSemaine, instantDebut } = fabriquer(cycle);
  // Un reset précis coupe sa fenêtre hebdo en segments. Un reset à l'instant exact du début de semaine ne coupe rien
  // (il créerait un segment vide).
  const precisDans = debutFenetre => resetsPrecis.map(p => p.quand)
    .filter(q => q > debutFenetre && q < debutFenetre + SEMAINE_MS);
  // Début du segment de l'instant t : dernier reset précis de la fenêtre ≤ t, sinon le début de la fenêtre
  const segmentDe = (t, debutFenetre) => Math.max(debutFenetre, ...precisDans(debutFenetre).filter(q => q <= t));

  const reponses = [...appels].map(a => ({ ...a, ...couts(a, { tarifs, paliers }) }));
  const sansTarif = [...new Set(reponses.filter(a => !tarifs[a.modele]).map(a => a.modele))];

  const total = vide();
  const parSemaine = {}, parJour = {}, parModele = {}, parSession = {};
  // Par jour de Paris : la page additionne sur la période choisie
  const jourProjet = {}, jourModeleTotal = {}, jourTailles = {};
  for (const a of reponses) {
    const jour = jourParis(a.ts);
    const contexte = a.entree + a.ecritureCache + a.lectureCache;
    ajouter(total, a);
    const semaine = (parSemaine[debutSemaine(a.ts)] ??= { ...vide(), modeles: {}, jetonsModeles: {} });
    ajouter(semaine, a);
    semaine.modeles[a.modele] = (semaine.modeles[a.modele] || 0) + a.cout;
    semaine.jetonsModeles[a.modele] = (semaine.jetonsModeles[a.modele] || 0) + jetons(a);
    ajouter(parJour[jour] ??= vide(), a);
    ajouter((jourProjet[jour] ??= {})[a.projet] ??= vide(), a);
    ajouter((jourModeleTotal[jour] ??= {})[a.modele] ??= vide(), a);
    ajouter(parModele[a.modele] ??= vide(), a);
    (jourTailles[jour] ??= [0, 0, 0, 0, 0])[trancheDe(contexte)]++;
    const s = (parSession[a.session] ??=
      { ...vide(), projet: a.projet, debut: a.ts, fin: a.ts, ctxMax: 0, sousAgents: 0, modeles: {} });
    ajouter(s, a);
    if (a.ts < s.debut) s.debut = a.ts;
    if (a.ts > s.fin) s.fin = a.ts;
    // Le contexte d'un sous-agent ne dit rien de celui de la session principale
    if (!a.sousAgent && contexte > s.ctxMax) s.ctxMax = contexte;
    if (a.sousAgent) s.sousAgents += jetons(a);
    s.modeles[a.modele] = (s.modeles[a.modele] || 0) + 1;
  }

  const tri = [...reponses].sort(parDate);
  const dansIntervalle = (debut, fin) => tri.filter(a => {
    const t = Date.parse(a.ts);
    return t >= debut && t <= fin;
  });
  const somme = (liste, champ) => liste.reduce((s, a) => s + a[champ], 0);

  // Plafond observé : coût consommé depuis l'ouverture du segment jusqu'au message de limite. Ouverture = remise à zéro
  // annoncée moins la durée de la fenêtre (5 h, ou 7 jours pour l'hebdo).
  const vus = new Set();
  const plafonds = [...limites].sort(parDate).map(l => {
    const atteinte = Date.parse(l.ts);
    const reset = l.type === 'hebdo'
      ? instantDebut(debutSemaine(atteinte + SEMAINE_MS))
      : parisVersUtc(atteinte, l.h, l.min);
    if (reset === null) return null;
    const debut = reset - (l.type === 'hebdo' ? SEMAINE_MS : 5 * HEURE_MS);
    const debutSeg = l.type === 'hebdo' ? segmentDe(atteinte, debut) : debut;
    // Même segment déjà compté : message répété. Un second message après un reset précis compte, lui.
    if (vus.has(l.type + debutSeg)) return null;
    vus.add(l.type + debutSeg);
    const dans = dansIntervalle(debutSeg, atteinte);
    return {
      type: l.type, atteinte: l.ts, debutFenetre: iso(debut), debutSegment: iso(debutSeg), reset: iso(reset),
      cout: r2(somme(dans, 'cout')), appels: dans.length, jetonsSortie: somme(dans, 'sortie'),
    };
  }).filter(Boolean);

  // Relevé du % affiché par l'appli : plafond projeté = coût depuis le début du segment ÷ %
  const coutEntre = (debut, fin) => tri.reduce((s, a) => {
    const t = Date.parse(a.ts);
    return t >= debut && t <= fin ? s + a.cout : s;
  }, 0);
  const sortieEntre = (debut, fin) => tri.reduce((s, a) => {
    const t = Date.parse(a.ts);
    return t >= debut && t <= fin ? s + a.sortie : s;
  }, 0);
  const utiles = releves.filter(r => r.hebdo >= PCT_MIN || r.cinqH >= PCT_MIN).sort(parDate);
  const projections = utiles.flatMap(r => {
    const t = Date.parse(r.ts), out = [];
    const fenetres = [['hebdo', r.hebdo, r.hebdoReset, SEMAINE_MS], ['5h', r.cinqH, r.cinqHReset, 5 * HEURE_MS]];
    for (const [type, pct, reset, duree] of fenetres) {
      if (!(pct >= PCT_MIN) || !Number.isFinite(Date.parse(reset))) continue; // métrique trop basse ou reset illisible
      const debut = Date.parse(reset) - duree;
      const debutSeg = type === 'hebdo' ? segmentDe(t, debut) : debut;
      const cout = coutEntre(debutSeg, t), sortie = sortieEntre(debutSeg, t);
      out.push({
        type, releve: r.ts, pct, debutFenetre: iso(debut), debutSegment: iso(debutSeg), coutAuReleve: r2(cout),
        plafondProjete: r2(cout / (pct / 100)), sortieProjetee: Math.round(sortie / (pct / 100)),
      });
    }
    return out;
  });

  // jour / jourFin : jours de Paris de la première et de la dernière réponse (filtre par période de la page)
  const sessions = Object.entries(parSession)
    .map(([id, s]) => ({ id: id.slice(0, 8), jour: jourParis(s.debut), jourFin: jourParis(s.fin), ...s }));
  // Semaines coupées par un reset précis : coût et jetons de sortie de chaque segment
  const semainesCoupees = [...new Set(resetsPrecis.filter(p => p.quand > instantDebut(p.semaine)).map(p => p.semaine))];
  const segmentsHebdo = semainesCoupees.sort().flatMap(semaine => {
    const debutFenetre = instantDebut(semaine);
    const bornes = [debutFenetre, ...precisDans(debutFenetre).sort((a, b) => a - b), debutFenetre + SEMAINE_MS];
    return bornes.slice(0, -1).map((debut, i) => {
      const fin = bornes[i + 1];
      const dans = tri.filter(a => {
        const t = Date.parse(a.ts);
        return t >= debut && t < fin;
      });
      return {
        semaine, debut: iso(debut), fin: iso(fin), cout: r2(somme(dans, 'cout')), sortie: somme(dans, 'sortie'),
      };
    });
  });
  // controles.mjs lit precis (instants en ISO) ; exporter.mjs reconstruit la table resets depuis la config
  const resetsDeclares = {
    semaines: resets,
    precis: resetsPrecis.map(p => ({ quand: iso(p.quand), type: p.type, note: p.note, semaine: p.semaine })),
  };

  return {
    sansTarif, total, plafonds, projections, segmentsHebdo, resetsDeclares,
    parSemaine, parJour, jourProjet, jourModeleTotal, jourTailles, parModele, sessions,
    jourReconstructions: reconstructions(reponses, [...compactages], cache),
  };
}
