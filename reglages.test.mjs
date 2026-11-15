// Tests des validateurs de réglages (15/11, plan #5) : node --test reglages.test.mjs
// Purs : aucune donnée ni config.local.json nécessaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCycle, lireResets, lireForfaits, CYCLE_DEFAUT } from './reglages.mjs';
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

// ---- Forfaits déclarés à la main (clé forfaits, 15/11, plan #2) ----
const forfaits = (valeur, cyc = lireCycle(undefined)) => lireForfaits(valeur, cyc, fabriquer(cyc).debutSemaine);
const semaineDe = (date, cyc) => forfaits({ [date]: 'Pro' }, cyc)[0].semaine;

test('lireForfaits : sans clé → liste vide', () => {
  assert.deepEqual(forfaits(undefined), []);
  assert.deepEqual(forfaits({}), []);
});

test('lireForfaits : le jour de la remise à zéro est dans la nouvelle semaine, quelle que soit l’heure du cycle', () => {
  assert.equal(semaineDe('2026-11-01', lireCycle(undefined)), '2026-11-01');                       // dimanche 10:00 (défaut)
  assert.equal(semaineDe('2026-10-31', lireCycle(undefined)), '2026-10-25');                       // samedi : semaine d'avant
  assert.equal(semaineDe('2026-11-01', lireCycle({ jour: 'dimanche', heureUTC: '18:00' })), '2026-11-01'); // après midi UTC
  assert.equal(semaineDe('2026-11-02', lireCycle({ jour: 'lundi', heureUTC: '08:00' })), '2026-11-02');   // lundi 08:00
  assert.equal(semaineDe('2026-11-01', lireCycle({ jour: 'lundi', heureUTC: '08:00' })), '2026-10-26');   // dimanche : semaine d'avant
  assert.equal(semaineDe('2026-11-03', lireCycle(undefined)), '2026-11-01');                       // mardi : semaine qui le contient
});

test('lireForfaits : tri par date, changement vrai seulement si le libellé change', () => {
  const r = forfaits({ '2026-11-08': 'Max 5x', '2026-11-01': 'Pro', '2026-11-15': ' max 5X ' });
  assert.deepEqual(r.map(e => e.date), ['2026-11-01', '2026-11-08', '2026-11-15']);
  assert.deepEqual(r.map(e => e.changement), [false, true, false]);
  assert.deepEqual(r[0], { date: '2026-11-01', semaine: '2026-11-01', forfait: 'Pro', changement: false });
});

test('lireForfaits : espaces de bord retirés, « Pro » puis « pro » = pas de changement', () => {
  const r = forfaits({ '2026-11-01': '  Pro  ', '2026-11-08': ' pro ' });
  assert.equal(r[0].forfait, 'Pro');
  assert.equal(r[1].changement, false);
});

test('lireForfaits : libellés génériques acceptés (lettres de toutes langues, chiffres, . + -)', () => {
  const r = forfaits({ '2026-11-01': 'Team Premium', '2026-11-08': 'Équipe', '2026-11-15': 'Max 5x', '2026-11-22': 'Ultra+' });
  assert.deepEqual(r.map(e => e.forfait), ['Team Premium', 'Équipe', 'Max 5x', 'Ultra+']);
});

test('lireForfaits : entrées invalides → erreur (échec fermé)', () => {
  const invalides = [
    [[], 'objet'], [null, 'objet'], ['Pro', 'objet'], [3, 'objet'],
    [{ '2026-13-01': 'Pro' }, 'illisible'], [{ '2026-1-5': 'Pro' }, 'illisible'], [{ '2026-02-30': 'Pro' }, 'illisible'],
    [{ '2026-11-01': '' }, 'vide'], [{ '2026-11-01': '   ' }, 'vide'],
    [{ '2026-11-01': 'a'.repeat(41) }, '40 caractères'],
    [{ '2026-11-01': 3 }, 'texte'],
    [{ '2026-11-01': 'Pro (50 %)' }, 'alphabet'],
    [{ '2026-11-01': 'Pro', '2026-11-03': 'Max 5x' }, 'même semaine'],
  ];
  for (const [v, motif] of invalides) assert.throws(() => forfaits(v), new RegExp(motif), JSON.stringify(v));
  assert.doesNotThrow(() => forfaits({ '2026-11-01': 'a'.repeat(40) }));
});
