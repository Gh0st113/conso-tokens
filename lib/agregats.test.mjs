// Tests du calcul de donnees.json (agregats.mjs) sur de petites réponses écrites à la main : coûts, jours et semaines,
// sessions, plafonds observés, projections et segments de reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreger } from './agregats.mjs';
import { CYCLE_DEFAUT } from './semaine.mjs';

const TARIFS = {
  tarifs: { 'Opus 5.5': [4, 20, 0.20], 'Haiku 5.5': [0.10, 0.50, 0.01] },
  paliers: { 'Haiku 5.5': { seuil: 100000, tarif: [0.50, 2.50, 0.05] } },
};
// Opus 5.5 : 50 000 jetons de sortie × 20 $ par million = 1 $
const UN_DOLLAR = { sortie: 50000 };
const appel = (ts, champs = {}) => ({
  ts, projet: 'p1', session: 'session-1', sousAgent: false, modele: 'Opus 5.5',
  entree: 0, ecritureCache: 0, ecriture1h: 0, ecriture5m: 0, lectureCache: 0, sortie: 0, reflexion: 0, ...champs,
});
const calculer = (appels, extra = {}) => agreger({
  appels, limites: [], releves: [], ...TARIFS, cycle: CYCLE_DEFAUT, resets: {}, resetsPrecis: [], ...extra,
});
const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('coût : tarif × jetons, écriture cache à 1,25 × (5 min) ou 2 × (1 h) le prix de l\'entrée', () => {
  const { total } = calculer([appel('2026-11-16T12:00:00Z', {
    entree: 1e6, ecritureCache: 2e6, ecriture5m: 1e6, ecriture1h: 1e6, lectureCache: 1e6, sortie: 1e6,
  })]);
  assert.equal(total.coutEntree, 4);
  assert.equal(total.coutEcriture, 13);
  assert.equal(total.coutLecture, 0.2);
  assert.equal(total.coutSortie, 20);
  proche(total.cout, 37.2);
});

test('palier : au-delà du seuil, toute la requête au tarif haut ; modèle sans tarif compté 0 $ et signalé', () => {
  const haiku = { modele: 'Haiku 5.5', entree: 60000, sortie: 1000 };
  const r = calculer([
    appel('2026-11-16T12:00:00Z', { ...haiku, session: 'haut', lectureCache: 50000 }),
    appel('2026-11-16T12:01:00Z', { ...haiku, session: 'pile', lectureCache: 40000 }),
    appel('2026-11-16T12:02:00Z', { session: 'truc', modele: 'Truc 9', entree: 1e6 }),
  ]);
  const session = id => r.sessions.find(s => s.id === id);
  proche(session('haut').cout, 0.03 + 0.0025 + 0.0025); // 110 000 > 100 000 : tarif haut partout
  proche(session('pile').cout, 0.006 + 0.0004 + 0.0005); // 100 000 pile : pas au-delà
  assert.equal(session('truc').cout, 0);
  assert.deepEqual(r.sansTarif, ['Truc 9']);
});

test('semaine du cycle en UTC, jour calendaire de Paris', () => {
  const r = calculer([
    appel('2026-11-15T09:59:00Z', UN_DOLLAR), // dimanche avant 10:00 UTC : semaine d'avant
    appel('2026-11-15T10:00:00Z', UN_DOLLAR),
    appel('2026-11-15T23:30:00Z', UN_DOLLAR), // 00:30 lundi à Paris
  ]);
  assert.deepEqual(Object.keys(r.parSemaine).sort(), ['2026-11-08', '2026-11-15']);
  assert.equal(r.parSemaine['2026-11-15'].cout, 2);
  assert.equal(r.parSemaine['2026-11-15'].modeles['Opus 5.5'], 2);
  assert.equal(r.parSemaine['2026-11-15'].jetonsModeles['Opus 5.5'], 100000);
  assert.deepEqual(Object.keys(r.parJour).sort(), ['2026-11-15', '2026-11-16']);
  assert.equal(r.parJour['2026-11-15'].appels, 2);
  assert.equal(r.jourProjet['2026-11-16'].p1.cout, 1);
  assert.equal(r.jourModeleTotal['2026-11-16']['Opus 5.5'].appels, 1);
  assert.equal(r.sessions[0].jour, '2026-11-15');
  assert.equal(r.sessions[0].jourFin, '2026-11-16');
});

test('session : contexte maximal hors sous-agents, jetons des sous-agents à part, réponses par modèle', () => {
  const s = 'principale-xyz', jour = '2026-11-16T';
  const r = calculer([
    appel(jour + '10:00:00Z', { session: s, entree: 1000, lectureCache: 39000, sortie: 100 }), // 40k
    appel(jour + '10:01:00Z', { session: s, sousAgent: true, lectureCache: 300000 }), // 300k, sous-agent
    appel(jour + '10:02:00Z', { session: s, modele: 'Haiku 5.5', entree: 120000 }), // 120k
  ]);
  assert.equal(r.sessions.length, 1);
  const session = r.sessions[0];
  assert.equal(session.id, 'principa');
  assert.equal(session.ctxMax, 120000);
  assert.equal(session.sousAgents, 300000);
  assert.deepEqual(session.modeles, { 'Opus 5.5': 2, 'Haiku 5.5': 1 });
  assert.deepEqual(r.jourTailles['2026-11-16'], [1, 0, 1, 0, 1]);
});

test('plafond hebdo observé : coût de l\'ouverture de la fenêtre au message ; message répété compté une fois', () => {
  const r = calculer([
    appel('2026-11-15T09:59:00Z', UN_DOLLAR), // fenêtre d'avant
    appel('2026-11-16T12:00:00Z', UN_DOLLAR),
    appel('2026-11-18T11:00:00Z', { sortie: 100000 }), // 2 $
    appel('2026-11-18T12:30:00Z', UN_DOLLAR), // après le message
  ], {
    limites: [
      { ts: '2026-11-18T12:00:00Z', type: 'hebdo', h: 0, min: 0 },
      { ts: '2026-11-18T13:00:00Z', type: 'hebdo', h: 0, min: 0 },
    ],
  });
  assert.deepEqual(r.plafonds, [{
    type: 'hebdo', atteinte: '2026-11-18T12:00:00Z', debutFenetre: '2026-11-15T10:00:00.000Z',
    debutSegment: '2026-11-15T10:00:00.000Z', reset: '2026-11-22T10:00:00.000Z',
    cout: 3, appels: 2, jetonsSortie: 150000,
  }]);
});

test('plafond 5 h : remise à zéro annoncée en heure de Paris, fenêtre des 5 h qui la précèdent', () => {
  const r = calculer([appel('2026-11-16T05:00:00Z', UN_DOLLAR), appel('2026-11-16T07:00:00Z', UN_DOLLAR)], {
    limites: [{ ts: '2026-11-16T08:00:00Z', type: '5h', h: 11, min: 30 }], // 11:30 à Paris = 10:30 UTC en novembre
  });
  assert.equal(r.plafonds.length, 1);
  assert.equal(r.plafonds[0].reset, '2026-11-16T10:30:00.000Z');
  assert.equal(r.plafonds[0].debutFenetre, '2026-11-16T05:30:00.000Z');
  assert.equal(r.plafonds[0].cout, 1);
});

test('relevé : coût depuis le début du segment ÷ % ; un reset précis coupe la fenêtre ; % sous 10 ignoré', () => {
  const reset = {
    quand: Date.parse('2026-11-17T12:00:00Z'), type: 'hebdo', note: 'reset du mardi', semaine: '2026-11-15',
  };
  const fins = { hebdoReset: '2026-11-22T10:00:00Z', cinqHReset: '2026-11-18T02:00:00Z' };
  const r = calculer([
    appel('2026-11-16T12:00:00Z', UN_DOLLAR), // 1er segment
    appel('2026-11-17T13:00:00Z', UN_DOLLAR), // 2e segment
    appel('2026-11-17T20:00:00Z', { sortie: 100000 }), // 2e segment, 2 $
  ], {
    resetsPrecis: [reset],
    releves: [
      { ts: '2026-11-18T00:00:00Z', hebdo: 20, cinqH: 5, ...fins },
      { ts: '2026-11-18T01:00:00Z', hebdo: 9, cinqH: 9, ...fins },
    ],
  });
  assert.deepEqual(r.projections, [{
    type: 'hebdo', releve: '2026-11-18T00:00:00Z', pct: 20, debutFenetre: '2026-11-15T10:00:00.000Z',
    debutSegment: '2026-11-17T12:00:00.000Z', coutAuReleve: 3, plafondProjete: 15, sortieProjetee: 750000,
  }]);
  const W = '2026-11-15T10:00:00.000Z', R = '2026-11-17T12:00:00.000Z', fin = '2026-11-22T10:00:00.000Z';
  assert.deepEqual(r.segmentsHebdo, [
    { semaine: '2026-11-15', debut: W, fin: R, cout: 1, sortie: 50000 },
    { semaine: '2026-11-15', debut: R, fin, cout: 3, sortie: 150000 },
  ]);
  assert.deepEqual(r.resetsDeclares.precis,
    [{ quand: '2026-11-17T12:00:00.000Z', type: 'hebdo', note: 'reset du mardi', semaine: '2026-11-15' }]);
});

test('reset précis à l\'instant exact du début de semaine : ne coupe rien (pas de segment vide)', () => {
  const reset = quand => ({ quand: Date.parse(quand), type: 'hebdo', note: '', semaine: '2026-11-15' });
  const seul = calculer([appel('2026-11-16T12:00:00Z', UN_DOLLAR)], {
    resetsPrecis: [reset('2026-11-15T10:00:00Z')],
    releves: [{ ts: '2026-11-17T00:00:00Z', hebdo: 20, hebdoReset: '2026-11-22T10:00:00Z' }],
  });
  assert.deepEqual(seul.segmentsHebdo, []);
  assert.equal(seul.projections[0].debutSegment, '2026-11-15T10:00:00.000Z');
  // Avec un second reset dans la semaine : deux segments, pas trois
  const avecUnAutre = calculer([appel('2026-11-16T12:00:00Z', UN_DOLLAR)], {
    resetsPrecis: [reset('2026-11-15T10:00:00Z'), reset('2026-11-17T12:00:00Z')],
  });
  assert.deepEqual(avecUnAutre.segmentsHebdo.map(s => [s.debut, s.cout]),
    [['2026-11-15T10:00:00.000Z', 1], ['2026-11-17T12:00:00.000Z', 0]]);
});
