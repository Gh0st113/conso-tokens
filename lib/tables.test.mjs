// Tests des tables du tableau de bord (tables.mjs), à partir de donnees.json calculé sur quelques réponses écrites à
// la main : jours et semaines continus, séries de modèles, sessions, codes, plafonds 5 h, format ancien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireTables, formatAncien, cleAuto } from './tables.mjs';
import { agreger } from './agregats.mjs';
import { CYCLE_DEFAUT } from './semaine.mjs';

const tarifs = { 'Opus 5.5': [4, 20, 0.20], 'Haiku 5.5': [0.10, 0.50, 0.01] };
const appel = (ts, champs = {}) => ({
  ts, projet: 'p1', session: 'session-1', sousAgent: false, modele: 'Opus 5.5',
  entree: 0, ecritureCache: 0, ecriture1h: 0, ecriture5m: 0, lectureCache: 0, sortie: 50000, reflexion: 0, ...champs,
}); // par défaut 1 $ : 50 000 jetons de sortie Opus 5.5
const donneesDe = appels => agreger({
  appels, limites: [], releves: [], tarifs, paliers: {}, cycle: CYCLE_DEFAUT, resets: {}, resetsPrecis: [],
});
const construire = (donnees, reglages = {}) => construireTables(donnees, {
  cycle: CYCLE_DEFAUT, resets: {}, resetsPrecis: [], forfaits: [], trous: [],
  maintenant: Date.parse('2026-11-18T12:00:00Z'), ...reglages,
});

test('jours continus : un jour sans appel vaut 0, un trou déclaré apparaît même après les données', () => {
  const donnees = donneesDe([appel('2026-11-16T12:00:00Z'), appel('2026-11-18T12:00:00Z')]);
  const { tables } = construire(donnees, { trous: [['2026-11-19', '2026-11-19', 'journaux perdus']] });
  assert.deepEqual(tables.jours, [
    { jour: '2026-11-16', cout: 1, appels: 1, jetons: 50000, manque: '' },
    { jour: '2026-11-17', cout: 0, appels: 0, jetons: 0, manque: '' },
    { jour: '2026-11-18', cout: 1, appels: 1, jetons: 50000, manque: '' },
    { jour: '2026-11-19', cout: 0, appels: 0, jetons: 0, manque: 'journaux perdus' },
  ]);
  assert.equal(tables.semaines.find(s => s.debut === '2026-11-15').manque, 'journaux perdus');
});

test('semaines continues : une semaine vide vaut 0, la semaine en cours apparaît même sans réponse', () => {
  const donnees = donneesDe([appel('2026-11-02T12:00:00Z'), appel('2026-11-16T12:00:00Z')]);
  const { tables } = construire(donnees, { maintenant: Date.parse('2026-11-23T12:00:00Z') });
  assert.deepEqual(tables.semaines.map(s => [s.debut, s.cout]),
    [['2026-11-01', 1], ['2026-11-08', 0], ['2026-11-15', 1], ['2026-11-22', 0]]);
  assert.deepEqual(tables.plafondsHebdo.map(l => l.etat), ['pasAtteint', 'pasAtteint', 'pasAtteint', 'enCours']);
});

test('modèle hors de GROUPES : série automatique, mêmes colonnes dans chaque ligne', () => {
  const donnees = donneesDe([
    appel('2026-11-10T12:00:00Z'),
    appel('2026-11-16T12:00:00Z', { modele: 'Opus 4.6', sortie: 1000 }),
  ]);
  const { tables, series, inconnus } = construire(donnees);
  assert.equal(cleAuto('Opus 4.6'), 'm_opus_4-6');
  assert.deepEqual(inconnus, ['Opus 4.6']);
  assert.ok(series.includes('opus55') && series.includes('m_opus_4-6'));
  for (const ligne of tables.semaines) {
    for (const cle of ['opus55', 'm_opus_4-6', 'jopus55', 'jm_opus_4-6']) {
      assert.ok(cle in ligne, `${ligne.debut} : ${cle}`);
    }
  }
  const [avant, apres] = tables.semaines;
  assert.equal(avant.opus55, 1);
  assert.equal(avant['m_opus_4-6'], 0);
  assert.equal(apres['jm_opus_4-6'], 1000);
});

test('sessions : triées par coût décroissant, modèle principal = celui qui a donné le plus de réponses', () => {
  const donnees = donneesDe([
    appel('2026-11-16T09:00:00Z', { session: 'petite-session' }),
    appel('2026-11-16T10:00:00Z', { session: 'grosse-session', sortie: 100000 }),
    appel('2026-11-16T10:05:00Z', { session: 'grosse-session', modele: 'Haiku 5.5', sortie: 10 }),
    appel('2026-11-16T10:06:00Z', { session: 'grosse-session', modele: 'Haiku 5.5', sortie: 10 }),
  ]);
  const { tables } = construire(donnees);
  assert.deepEqual(tables.sessions.map(s => [s.session, s.modele, s.debut]),
    [['grosse-s', 'Haiku 5.5', '2026-11-16 10:00'], ['petite-s', 'Opus 5.5', '2026-11-16 09:00']]);
});

test('types de jetons et tranches de contexte : des codes, la page fait les libellés', () => {
  const donnees = donneesDe([appel('2026-11-16T12:00:00Z', { entree: 40000, lectureCache: 80000 })]); // 120k
  const { tables } = construire(donnees);
  assert.deepEqual(tables.types.map(t => t.type), ['cacheRead', 'cacheWrite', 'output', 'input']);
  assert.deepEqual(tables.contexte.map(c => [c.tranche, c.appels]),
    [['0-50k', 0], ['50-100k', 0], ['100-150k', 1], ['150-250k', 0], ['250k+', 0]]);
});

test('plafonds 5 h : relevés à 50 % et plus seulement, triés par moment', () => {
  const donnees = {
    ...donneesDe([appel('2026-11-16T07:00:00Z')]),
    plafonds: [{ type: '5h', atteinte: '2026-11-16T10:00:00Z', cout: 11, jetonsSortie: 3 }],
    projections: [
      { type: '5h', releve: '2026-11-16T09:00:00Z', pct: 40, plafondProjete: 10, sortieProjetee: 1 },
      { type: '5h', releve: '2026-11-16T08:00:00Z', pct: 60, plafondProjete: 12, sortieProjetee: 2 },
    ],
  };
  assert.deepEqual(construire(donnees).tables.plafonds5h, [
    { moment: '2026-11-16T08:00', etat: 'projete', pct: 60, plafond: 12, sortie: 2 },
    { moment: '2026-11-16T10:00', etat: 'atteint', pct: null, plafond: 11, sortie: 3 },
  ]);
});

test('resets déclarés : une ligne par reset des deux formes, triés par semaine puis par instant', () => {
  const precis = (quand, semaine) => ({ quand: Date.parse(quand), type: 'hebdo', note: 'n', semaine });
  const { tables } = construire(donneesDe([appel('2026-11-16T12:00:00Z')]), {
    resets: { '2026-11-08': 'dimanche' },
    resetsPrecis: [precis('2026-11-17T12:00:00Z', '2026-11-15'), precis('2026-11-16T12:00:00Z', '2026-11-15')],
  });
  assert.deepEqual(tables.resets, [
    { quand: '', type: 'hebdo', note: 'dimanche', semaine: '2026-11-08' },
    { quand: '2026-11-16T12:00', type: 'hebdo', note: 'n', semaine: '2026-11-15' },
    { quand: '2026-11-17T12:00', type: 'hebdo', note: 'n', semaine: '2026-11-15' },
  ]);
});

test('format ancien : donnees.json sans champs par jour ou sans segments de reset → refusé', () => {
  const donnees = donneesDe([appel('2026-11-16T12:00:00Z')]);
  assert.equal(formatAncien(donnees), false);
  assert.equal(formatAncien({ ...donnees, jourProjet: undefined }), true);
  assert.equal(formatAncien({ ...donnees, projections: [{ type: 'hebdo' }] }), true);
});

test('reconstructions : ligne total par jour, puis une ligne par cause présente ; donnees sans le champ = ancien format', () => {
  const donnees = donneesDe([
    appel('2026-11-16T10:00:00Z', { sortie: 0, lectureCache: 200000 }),
    appel('2026-11-16T10:31:00Z', { sortie: 0, ecritureCache: 40000, ecriture5m: 40000, lectureCache: 15000 }),
  ]);
  assert.deepEqual(construire(donnees).tables.reconstructions, [
    { jour: '2026-11-16', cause: 'total', nombre: 2, jetons: 40000, cout: 0.2 },
    { jour: '2026-11-16', cause: 'pause', nombre: 1, jetons: 40000, cout: 0.2 },
  ]);
  const { jourReconstructions, ...ancien } = donnees;
  assert.equal(formatAncien(ancien), true);
});
