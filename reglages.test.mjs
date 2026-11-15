// Tests des validateurs de réglages (19/11, plan #5) : node --test reglages.test.mjs
// Purs : aucune donnée ni config.local.json nécessaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCycle, lireResets, CYCLE_DEFAUT } from './reglages.mjs';
import * as semaine from './semaine.mjs';
import { fabriquer } from './semaine.mjs';

const defaut = fabriquer(lireCycle(undefined)).debutSemaine;
const cycle = valeur => fabriquer(lireCycle(valeur)).debutSemaine;

test('lireCycle : même fonction depuis reglages.mjs et depuis semaine.mjs (API canonique)', () => {
  assert.equal(semaine.lireCycle, lireCycle);
  assert.equal(semaine.CYCLE_DEFAUT, CYCLE_DEFAUT);
});

test('lireResets : cinq entrées invalides, cinq erreurs', () => {
  const invalides = [
    [{ quand: '2026-11-03 21:00', type: 'hebdo' }],                                   // espace au lieu de T
    [{ quand: '2026-11-03T21:00', type: 'hebdo' }],                                   // sans Z
    [{ quand: '2026-11-03T21:00Z', type: 'fable' }],                                  // type inconnu
    [{ quand: '2026-11-03T21:00Z', type: 'hebdo', lieu: 'x' }],                       // champ en trop
    [{ quand: '2026-11-03T21:00Z', type: 'hebdo' }, { quand: '2026-11-03T21:00Z', type: 'hebdo' }], // doublon
  ];
  for (const v of invalides) assert.throws(() => lireResets(v, defaut), Error, JSON.stringify(v));
  assert.throws(() => lireResets([{ quand: '2026-11-03T21:00:00Z', type: 'hebdo' }], defaut), /« quand »/, 'secondes refusées');
  assert.throws(() => lireResets([{ quand: '2026-02-31T21:00Z', type: 'hebdo' }], defaut), /« quand »/, 'date impossible');
});

test('lireResets : ancienne forme → même table semaines, precis vide', () => {
  assert.deepEqual(lireResets({ '2026-01-04': 'nuit du 3 au 4' }, defaut), { semaines: { '2026-01-04': 'nuit du 3 au 4' }, precis: [] });
});

test('lireResets : nouvelle forme → semaines vide, semaine du reset selon le cycle', () => {
  const v = [{ quand: '2026-11-03T21:00Z', type: 'hebdo', note: 'essai' }];
  const r = lireResets(v, defaut);
  assert.deepEqual(r.semaines, {});
  assert.equal(r.precis.length, 1);
  assert.equal(r.precis[0].semaine, '2026-11-01');   // dimanche 10:00 UTC : la semaine commence le 1er
  assert.equal(r.precis[0].quand, Date.parse('2026-11-03T21:00Z'));
  assert.equal(r.precis[0].note, 'essai');
  assert.equal(lireResets(v, cycle({ jour: 'lundi', heureUTC: '08:00' })).precis[0].semaine, '2026-11-02');
  assert.equal(lireResets([{ quand: '2026-11-01T09:00Z', type: 'hebdo' }], defaut).precis[0].semaine, '2026-10-25');
});

test('lireResets : note facultative, absent → rien ; liste vide → rien', () => {
  assert.equal(lireResets([{ quand: '2026-11-03T21:00Z', type: 'hebdo' }], defaut).precis[0].note, '');
  assert.deepEqual(lireResets(undefined, defaut), { semaines: {}, precis: [] });
  assert.deepEqual(lireResets([], defaut), { semaines: {}, precis: [] });
});
