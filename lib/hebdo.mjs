// Plafond hebdo du forfait, en dollars : usage hors de ce PC, pentes entre relevés, ligne du comparatif par semaine.
// Les lignes ne portent que des codes et des nombres : la page en fait les phrases (bloc #libelles de page/index.html).
// Pur : aucun accès disque ; `maintenant` en paramètre.
import { forfaitDe } from './controles.mjs';
import { HEURE_MS, SEMAINE_MS, iso, jourUTC, midi } from './temps.mjs';

const r2 = n => Math.round(n * 100) / 100;
const r1 = n => Math.round(n * 10) / 10;

// Usage hors de ce PC (Cowork distant, claude.ai, téléphone), repéré entre deux relevés hebdo consécutifs du même
// segment : plus d'une heure d'écart, et au moins 1 point de hausse pour moins de 0,5 $ par point dans les journaux
// (un point coûte en général bien plus). Ces points sont retirés du % des relevés suivants (pctLocal) et une pente ne
// les enjambe jamais. Les sauts d'une minute (arrondi du %) restent sous le seuil de durée.
// Points retirés = hausse − part payée en local (coût local ÷ prix de référence d'un point).
// Seuil de 1 point : le % est arrondi à l'entier inférieur, donc une hausse lue de N points vaut entre N − 1 et N + 1
// points réels ; un seuil de 2 ratait les hausses de 1 point à coût nul. Chaque période compte donc ±1 point
// d'incertitude (voir fourchette).
// Silence : plus d'une heure sans relevé alors que plus de 5 $ (≈ 2 points) ont été consommés en local = le relevé ne
// tournait pas. Un usage hors PC pendant ce silence est invisible : la pente qui l'enjambe est gardée, marquée silence.
export const HORS = { duree: HEURE_MS, points: 1, dollarsParPoint: 0.5, prixPoint: 2.44, silenceDollars: 5 };
// Fourchette plus large que 25 % du plafond central → pas de plafond, la fourchette seule (fourchetteMin /
// fourchetteMax, fourchetteIncertaine) : ex. semaine où l'essentiel du % a été pris hors de ce PC
const LARGEUR_MAX = 0.25;
// Écart de % minimal d'une pente : en dessous, l'arrondi du % pèse trop
const ECART_MIN = 8;
// Sous 10 % local, la division coût ÷ % est trop bruitée
const LOCAL_MIN = 10;
// Champs d'une ligne de plafondsHebdo : mêmes colonnes dans chaque ligne, un champ sans objet pour cet état vaut null
const VIDE_HEBDO = {
  etat: null, pct: null, enCours: false, projete100: false,
  fourchetteMin: null, fourchetteMax: null, fourchetteIncertaine: false,
  resetNote: null, coupeePremier: null, coupeeDepuis: null, indicatifDe: null, indicatifA: null,
};

// Plafond si la part locale est entre local − n et local + n points ; sous 10 % local, borne haute inconnue
const fourchette = (cout, local, n) => ({
  min: r2(cout * 100 / (local + n)),
  max: local - n >= LOCAL_MIN ? r2(cout * 100 / (local - n)) : null,
});

// État d'une semaine (liste : ETATS_HEBDO de controles.mjs)
function etatHebdo({ atteint, plein, contredit, enCours, proj, plafond }) {
  if (atteint) return 'atteint';
  if (plein) return 'plein';
  if (contredit) return 'depasse';
  if (!proj) return enCours ? 'enCours' : 'pasAtteint';
  if (enCours) return plafond != null ? 'projete' : 'enCours';
  // Semaine finie sans message de blocage ni relevé à 100 % : le plafond reste une projection
  return 'pasAtteint';
}

// donnees : contenu de donnees.json (lu, jamais modifié). resets : semaines entières perdues (ancienne forme de la clé
// resets) ; forfaits : clé forfaits ; instantDebut : semaine.mjs.
// Rend plafondSemaine(debut, totalSemaine) → ligne du comparatif hebdo, et les pentes.
export function analyserHebdo(donnees, { resets, forfaits, instantDebut, maintenant }) {
  // Copies : les relevés hebdo reçoivent pctLocal, apresCoupure et apresSilence
  const projections = donnees.projections.map(p => ({ ...p }));
  const hebdo = projections.filter(p => p.type === 'hebdo');

  // Relevés hebdo par segment (début de fenêtre, ou reset précis de la semaine) : une pente ne relie jamais deux
  // segments
  const parSegment = {};
  for (const p of hebdo) (parSegment[p.debutSegment] ??= []).push(p);
  const horsJournaux = [];
  for (const releves of Object.values(parSegment)) {
    releves.sort((a, b) => a.releve < b.releve ? -1 : 1);
    let retire = 0;
    for (const [i, apres] of releves.entries()) {
      const avant = releves[i - 1];
      if (avant) {
        const hausse = apres.pct - avant.pct;
        const coutLocal = apres.coutAuReleve - avant.coutAuReleve;
        const long = Date.parse(apres.releve) - Date.parse(avant.releve) > HORS.duree;
        if (long && hausse >= HORS.points && coutLocal < hausse * HORS.dollarsParPoint) {
          const points = r1(hausse - coutLocal / HORS.prixPoint);
          retire += points;
          apres.apresCoupure = true;
          horsJournaux.push({ semaine: apres.debutSegment, debut: avant.releve, fin: apres.releve, points });
        } else if (long && coutLocal > HORS.silenceDollars) {
          apres.apresSilence = true;
        }
      }
      apres.pctLocal = Math.max(0, apres.pct - retire);
    }
  }
  // Périodes hors PC du segment commencé à debutSegment, commencées avant l'instant ts
  const periodesHorsAvant = (debutSegment, ts) =>
    horsJournaux.filter(h => h.semaine === debutSegment && Date.parse(h.debut) < Date.parse(ts));
  const horsAvant = (debutSegment, ts) => periodesHorsAvant(debutSegment, ts).reduce((s, h) => s + h.points, 0);

  // Semaine coupée par des resets précis : un segment par reset, chacun avec son coût (segmentsHebdo) et ses relevés.
  // La ligne suit le segment retenu : celui de plus grand % local (à égalité, le plus récent).
  const segmentsDe = debut => donnees.segmentsHebdo.filter(s => s.semaine === debut);
  // Ce qui mesure un segment : la limite atteinte (message de blocage), sinon son dernier relevé hebdo
  const etatSegment = debutSegment => ({
    atteint: donnees.plafonds.find(p => p.type === 'hebdo' && p.debutSegment === debutSegment),
    proj: hebdo.filter(p => p.debutSegment === debutSegment).at(-1),
  });
  // Points pris hors de ce PC, et % local (100 si la limite est atteinte, sinon % du dernier relevé, moins ces points).
  // Au dixième : le choix du segment retenu et la ligne affichée doivent voir les mêmes valeurs.
  const partLocale = ({ atteint, proj }) => {
    const hors = r1(atteint ? horsAvant(atteint.debutSegment, atteint.atteinte) : proj ? proj.pct - proj.pctLocal : 0);
    return { hors, local: Math.max(0, (atteint ? 100 : proj?.pct ?? 0) - hors) };
  };
  // % local d'un segment ; null sans limite ni relevé
  const localDe = etat => etat.atteint || etat.proj ? partLocale(etat).local : null;
  // Mesure de fin d'un segment : la limite atteinte, sinon le dernier relevé ; rien des deux : 0
  const mesureDe = ({ atteint, proj }) => {
    if (atteint) return { pct: 100, cout: atteint.cout, instant: atteint.atteinte };
    if (proj) return { pct: Math.min(100, proj.pct), cout: proj.coutAuReleve, instant: proj.releve };
    return { pct: 0, cout: 0, instant: null };
  };
  // Semaine coupée : premier reset qui coupe vraiment (début du 2e segment : le 1er part du début de semaine) et début
  // du segment retenu, en ISO UTC à la minute
  const coupeeDe = (debut, debutSegment) => ({
    coupeePremier: (segmentsDe(debut)[1]?.debut ?? debutSegment).slice(0, 16),
    coupeeDepuis: debutSegment.slice(0, 16),
  });

  // Une ligne du comparatif hebdo, pour le segment retenu (coutSegment : coût de ce segment ; totalSemaine : agrégat
  // de toute la semaine)
  const ligneHebdo = (debut, debutSegment, coutSegment, { atteint, proj }, totalSemaine) => {
    const enCours = instantDebut(debut) + SEMAINE_MS > maintenant;
    // Relevé à 100 % sans message de blocage (sonar, ou relevé noté à la main quand le blocage a eu lieu hors de ce PC)
    const plein = !atteint && proj?.pct >= 100;
    // La part prise hors de ce PC est retirée avant de ramener le coût local à 100 %
    const { hors, local } = partLocale({ atteint, proj });
    const echelle = local >= LOCAL_MIN ? 100 / local : null;
    const mesure = mesureDe({ atteint, proj });
    const nbHors = mesure.instant ? periodesHorsAvant(debutSegment, mesure.instant).length : 0;
    const bornes = nbHors && local >= LOCAL_MIN ? fourchette(mesure.cout, local, nbHors) : null;
    const plafondCentral = echelle != null ? r2(mesure.cout * echelle) : null;
    const tropLarge = bornes != null && plafondCentral != null
      && (bornes.max == null || bornes.max - bornes.min > LARGEUR_MAX * plafondCentral);
    const plafond = tropLarge ? null : plafondCentral;
    // Colonne « Hors PC » : les points repérés période par période, au dixième comme la note « dont N pts » de la page
    // (un arrondi à l'entier afficherait « ≈ 0 pts » pour 0,4 pt). Un usage hors PC simultané à Claude Code reste
    // invisible : il se fond dans le prix du point de la pente.
    const horsEstime = hors > 0 ? hors : null;
    // Projection contredite : le segment a consommé plus que le 100 % projeté sans l'atteindre → pas de plafond,
    // seulement « au moins le consommé ». Comparé au plafond central même s'il n'est pas affiché : un dépassement reste
    // un dépassement.
    const contredit = !atteint && !plein && plafondCentral != null && coutSegment > plafondCentral;
    // Jetons de sortie ramenés à 100 %, avec les mêmes refus que le plafond
    const sortieA100 = () => {
      if (contredit || tropLarge || echelle == null) return null;
      if (atteint) return Math.round(atteint.jetonsSortie * echelle);
      return Math.round(proj.sortieProjetee * proj.pct / 100 * echelle);
    };
    return {
      semaine: debut,
      ...VIDE_HEBDO,
      etat: etatHebdo({ atteint, plein, contredit, enCours, proj, plafond }),
      pct: atteint || plein || !proj ? null : proj.pct,
      enCours,
      projete100: !!proj && plafond != null,
      // Fourchette seulement avec des points hors de ce PC : la page la montre dans la note « dont N pts »
      ...(bornes && horsEstime != null
        ? { fourchetteMin: bornes.min, fourchetteMax: bornes.max, fourchetteIncertaine: tropLarge } : {}),
      pctFin: horsEstime == null ? null : mesure.pct,
      horsEstime,
      plafond: contredit ? null : plafond,
      sortie: sortieA100(),
      consomme: r2(totalSemaine.cout),
      consommeSortie: totalSemaine.sortie, // jetons de sortie de la semaine, pour la vue « jetons » de la page
    };
  };

  // Semaine de changement de forfait : indicatifDe → indicatifA (forfait de la semaine d'avant, « inconnu » si aucun).
  // Ni comparée aux autres semaines ni contrôlée côté plafond (controles.mjs et la page le savent).
  const changementsSemaines = new Set(forfaits.filter(f => f.changement).map(f => f.semaine));
  const indicatif = (debut, ligne) => {
    if (!changementsSemaines.has(debut)) return ligne;
    const avant = forfaitDe(forfaits, jourUTC(midi(debut) - SEMAINE_MS)) || 'inconnu';
    return { ...ligne, indicatifDe: avant, indicatifA: forfaitDe(forfaits, debut) };
  };

  // Comparatif hebdo, une ligne par semaine : plafond atteint, projeté depuis un relevé, ou seulement borne basse
  const plafondSemaine = (debut, totalSemaine) => {
    // Reset déclaré pour toute la semaine (ancienne forme) : le compteur repart de zéro sans que la fin bouge, coût ÷ %
    // n'a plus de sens → pas de plafond
    const reset = resets[debut];
    if (reset) {
      return indicatif(debut, {
        semaine: debut, ...VIDE_HEBDO, etat: 'reset', resetNote: String(reset), pctFin: null, horsEstime: null,
        plafond: null, sortie: null, consomme: r2(totalSemaine.cout), consommeSortie: totalSemaine.sortie,
      });
    }
    // Semaine coupée par des resets précis : une ligne quand même, sur le segment retenu (coupeePremier, coupeeDepuis)
    const coupees = segmentsDe(debut);
    const segments = coupees.length
      ? coupees.map(s => ({ debutSegment: s.debut, cout: s.cout }))
      : [{ debutSegment: iso(instantDebut(debut)), cout: totalSemaine.cout }];
    // Segment retenu : plus grand % local ; à égalité, le plus récent. Sans relevé ni limite : le dernier, sans plafond
    let choisi = null;
    for (const segment of segments) {
      const etat = etatSegment(segment.debutSegment);
      const loc = localDe(etat);
      if (loc != null && (!choisi || loc >= choisi.loc)) choisi = { ...segment, etat, loc };
    }
    choisi ??= { ...segments.at(-1), etat: {} };
    const ligne = ligneHebdo(debut, choisi.debutSegment, choisi.cout, choisi.etat, totalSemaine);
    if (coupees.length) Object.assign(ligne, coupeeDe(debut, choisi.debutSegment));
    return indicatif(debut, ligne);
  };

  // Pente : coût consommé entre deux relevés hebdo du même segment ÷ écart de % local. Insensible à ce qui a été
  // consommé hors journaux AVANT le premier relevé ; une période hors PC coupe la pente : on repart du relevé qui suit.
  const pentes = [];
  for (const releves of Object.values(parSegment)) {
    let avant = releves[0];
    let silence = false;
    for (const apres of releves.slice(1)) {
      if (apres.apresCoupure) {
        avant = apres;
        silence = false;
        continue;
      }
      silence ||= !!apres.apresSilence;
      const ecart = apres.pctLocal - avant.pctLocal;
      if (ecart < ECART_MIN) continue;
      pentes.push({
        debut: avant.releve.slice(0, 16),
        fin: apres.releve.slice(0, 16),
        ecart: r1(ecart),
        heures: r2((Date.parse(apres.releve) - Date.parse(avant.releve)) / HEURE_MS),
        plafond: Math.round((apres.coutAuReleve - avant.coutAuReleve) / ecart * 100),
        silence,
      });
      avant = apres;
      silence = false;
    }
  }
  pentes.sort((a, b) => a.debut < b.debut ? -1 : 1);

  return { plafondSemaine, pentes };
}
