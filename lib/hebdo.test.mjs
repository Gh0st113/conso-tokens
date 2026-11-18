// Tests du plafond hebdo (hebdo.mjs) sur des relevés écrits à la main : pentes, usage hors de ce PC, état de chaque
// cas, resets et forfaits. Les phrases affichées sont testées à part (libelles.test.mjs, à la racine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserHebdo } from './hebdo.mjs';
import { fabriquer, CYCLE_DEFAUT } from './semaine.mjs';
import { ETATS_HEBDO } from './controles.mjs';

const { instantDebut } = fabriquer(CYCLE_DEFAUT);
const SEMAINE = '2026-11-15', W = '2026-11-15T10:00:00.000Z';
const PENDANT = Date.parse('2026-11-18T12:00:00Z'); // semaine en cours
const APRES = Date.parse('2026-11-25T12:00:00Z'); // semaine finie
// Relevé hebdo du lundi 16/11 à l'heure donnée
const releve = (heure, pct, coutAuReleve, debutSegment = W) => ({
  type: 'hebdo', releve: `2026-11-16T${heure}:00Z`, pct, debutFenetre: W, debutSegment, coutAuReleve,
  plafondProjete: 0, sortieProjetee: 1000,
});
const analyser = (donnees, reglages = {}) => analyserHebdo(
  { projections: [], plafonds: [], segmentsHebdo: [], ...donnees },
  { resets: {}, forfaits: [], instantDebut, maintenant: PENDANT, ...reglages });
const semaine = cout => ({ cout, sortie: 0 });
// Champs sans objet pour un état : mêmes valeurs par défaut que hebdo.mjs
const VIDE = {
  etat: null, pct: null, enCours: false, projete100: false,
  fourchetteMin: null, fourchetteMax: null, fourchetteIncertaine: false,
  resetNote: null, coupeePremier: null, coupeeDepuis: null, indicatifDe: null, indicatifA: null,
};

test('pente : coût entre deux relevés ÷ écart de % ; sous 8 points, on attend le relevé suivant', () => {
  const projections = [releve('00:00', 10, 20), releve('00:30', 15, 30), releve('01:00', 30, 60)];
  const { pentes } = analyser({ projections });
  assert.deepEqual(pentes, [
    { debut: '2026-11-16T00:00', fin: '2026-11-16T01:00', ecart: 20, heures: 1, plafond: 200, silence: false },
  ]);
});

test('hors PC : une hausse sans coût local est retirée des relevés suivants, et la pente ne l\'enjambe pas', () => {
  const donnees = {
    projections: [
      releve('00:00', 10, 20), releve('00:30', 30, 60),
      releve('03:00', 40, 60.5), // +10 points pour 0,50 $ en 2 h 30 : 9,8 points pris hors de ce PC
      releve('03:30', 50, 80.5),
    ],
  };
  const { pentes, plafondSemaine } = analyser(donnees);
  assert.deepEqual(pentes, [
    { debut: '2026-11-16T00:00', fin: '2026-11-16T00:30', ecart: 20, heures: 0.5, plafond: 200, silence: false },
    { debut: '2026-11-16T03:00', fin: '2026-11-16T03:30', ecart: 10, heures: 0.5, plafond: 200, silence: false },
  ]);
  // 50 % lus − 9,8 hors PC = 40,2 % local : 80,50 $ ÷ 40,2 % ; ±1 point d'arrondi → entre 80,50 ÷ 41,2 et ÷ 39,2
  assert.deepEqual(plafondSemaine(SEMAINE, semaine(80.5)), {
    semaine: SEMAINE, ...VIDE, etat: 'projete', pct: 50, enCours: true, projete100: true,
    fourchetteMin: 195.39, fourchetteMax: 205.36, fourchetteIncertaine: false,
    pctFin: 50, horsEstime: 9.8, plafond: 200.25, sortie: 1244, consomme: 80.5, consommeSortie: 0,
  });
  assert.equal(donnees.projections[3].pctLocal, undefined, 'les relevés de donnees.json ne sont pas modifiés');
});

test('fourchette trop large (plus de 25 % du plafond central) : pas de plafond, semaine seulement en cours', () => {
  const projections = [
    releve('00:00', 10, 20),
    releve('02:00', 15, 20), releve('04:00', 20, 20), // deux sauts de 5 points sans coût local : hors de ce PC
    releve('04:30', 22, 24),
  ];
  // 22 % lus − 10 hors PC = 12 % local, ±2 points : entre 24 $ ÷ 14 % et 24 $ ÷ 10 %, pour 200 $ au centre
  const ligne = analyser({ projections }).plafondSemaine(SEMAINE, semaine(24));
  assert.deepEqual(ligne, {
    semaine: SEMAINE, ...VIDE, etat: 'enCours', pct: 22, enCours: true, projete100: false,
    fourchetteMin: 171.43, fourchetteMax: 240, fourchetteIncertaine: true,
    pctFin: 22, horsEstime: 10, plafond: null, sortie: null, consomme: 24, consommeSortie: 0,
  });
});

test('état : limite atteinte, relevé à 100 %, semaine finie, semaine sans relevé', () => {
  const atteint = { type: 'hebdo', debutSegment: W, atteinte: '2026-11-18T12:00:00Z', cout: 150, jetonsSortie: 1000 };
  const ligne = analyser({ plafonds: [atteint] }).plafondSemaine(SEMAINE, semaine(150));
  assert.equal(ligne.etat, 'atteint');
  assert.equal(ligne.plafond, 150);
  assert.equal(ligne.sortie, 1000);

  const plein = analyser({ projections: [releve('00:00', 100, 180)] }).plafondSemaine(SEMAINE, semaine(180));
  assert.equal(plein.etat, 'plein');
  assert.equal(plein.pct, null);
  assert.equal(plein.plafond, 180);

  const fini = analyser({ projections: [releve('00:00', 60, 120)] }, { maintenant: APRES })
    .plafondSemaine(SEMAINE, semaine(120));
  assert.deepEqual([fini.etat, fini.pct, fini.enCours, fini.projete100, fini.plafond],
    ['pasAtteint', 60, false, true, 200]);

  const vide = analyser({}).plafondSemaine(SEMAINE, semaine(5));
  assert.deepEqual([vide.etat, vide.pct, vide.plafond], ['enCours', null, null]);
  assert.equal(analyser({}, { maintenant: APRES }).plafondSemaine(SEMAINE, semaine(5)).etat, 'pasAtteint');
  for (const l of [ligne, plein, fini, vide]) assert.ok(ETATS_HEBDO.includes(l.etat), l.etat);
});

test('projection contredite : plus consommé que le 100 % projeté → état depasse, pas de plafond', () => {
  const ligne = analyser({ projections: [releve('00:00', 50, 100)] }).plafondSemaine(SEMAINE, semaine(250));
  assert.deepEqual([ligne.etat, ligne.pct, ligne.enCours], ['depasse', 50, true]);
  assert.equal(ligne.plafond, null);
  assert.equal(ligne.sortie, null);
});

test('reset déclaré pour toute la semaine : état reset, pas de plafond', () => {
  const ligne = analyser({ projections: [releve('00:00', 50, 100)] }, { resets: { [SEMAINE]: 'mardi soir' } })
    .plafondSemaine(SEMAINE, semaine(12.341));
  assert.deepEqual(ligne, {
    semaine: SEMAINE, ...VIDE, etat: 'reset', resetNote: 'mardi soir',
    pctFin: null, horsEstime: null, plafond: null, sortie: null, consomme: 12.34, consommeSortie: 0,
  });
});

test('semaine coupée par un reset précis : segment de plus grand % local, à égalité le plus récent', () => {
  const R = '2026-11-17T12:00:00.000Z';
  const donnees = {
    segmentsHebdo: [
      { semaine: SEMAINE, debut: W, fin: R, cout: 30, sortie: 0 },
      { semaine: SEMAINE, debut: R, fin: '2026-11-22T10:00:00.000Z', cout: 50, sortie: 0 },
    ],
    projections: [releve('00:00', 60, 30), { ...releve('00:00', 20, 10, R), releve: '2026-11-18T00:00:00Z' }],
  };
  const ligne = analyser(donnees).plafondSemaine(SEMAINE, semaine(80));
  assert.deepEqual([ligne.etat, ligne.pct, ligne.coupeePremier, ligne.coupeeDepuis],
    ['projete', 60, '2026-11-17T12:00', '2026-11-15T10:00']);
  assert.equal(ligne.plafond, 50); // 30 $ ÷ 60 %, coût du segment retenu seulement

  donnees.projections[1] = { ...donnees.projections[1], pct: 60, coutAuReleve: 40 };
  const egalite = analyser(donnees).plafondSemaine(SEMAINE, semaine(80));
  assert.equal(egalite.coupeeDepuis, '2026-11-17T12:00');
  assert.equal(egalite.plafond, 66.67); // 40 $ ÷ 60 % ; le segment a consommé 50 $, moins que ce plafond
});

test('changement de forfait : plafond indicatif, du forfait d\'avant au nouveau', () => {
  const forfaits = [
    { date: '2026-11-10', semaine: '2026-11-08', forfait: 'Pro', changement: false },
    { date: '2026-11-16', semaine: SEMAINE, forfait: 'Max 5x', changement: true },
  ];
  const { plafondSemaine } = analyser({}, { forfaits });
  const change = plafondSemaine(SEMAINE, semaine(5));
  assert.deepEqual([change.etat, change.indicatifDe, change.indicatifA], ['enCours', 'Pro', 'Max 5x']);
  assert.equal(plafondSemaine('2026-11-08', semaine(5)).indicatifA, null);
});
