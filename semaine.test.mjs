// Tests du début de semaine de forfait (semaine.mjs) : cycle par défaut, cycles réglés, valeurs invalides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCycle, fabriquer, CYCLE_DEFAUT } from './semaine.mjs';

const defaut = fabriquer(lireCycle(undefined));
const cycle = valeur => fabriquer(lireCycle(valeur));

test('défaut : dimanche 10:00 UTC, comme avant', () => {
  assert.deepEqual(lireCycle(undefined), CYCLE_DEFAUT);
  assert.equal(defaut.debutSemaine('2026-11-15T09:59:59Z'), '2026-11-08');
  assert.equal(defaut.debutSemaine('2026-11-15T10:00:00Z'), '2026-11-15');
});

test('défaut : un mercredi tombe sur le dimanche précédent', () => {
  assert.equal(defaut.debutSemaine('2026-11-18T12:00:00Z'), '2026-11-15');
});

test('défaut : instant de remise à zéro = dimanche 10:00 UTC', () => {
  assert.equal(defaut.instantDebut('2026-11-15'), Date.parse('2026-11-15T10:00:00Z'));
});

test('lundi 08:00 UTC : 07:59 appartient au lundi précédent, 08:00 au nouveau', () => {
  const c = cycle({ jour: 'lundi', heureUTC: '08:00' });
  // 2026-11-16 est un lundi
  assert.equal(c.debutSemaine('2026-11-16T07:59:59Z'), '2026-11-09');
  assert.equal(c.debutSemaine('2026-11-16T08:00:00Z'), '2026-11-16');
  assert.equal(c.debutSemaine('2026-11-18T12:00:00Z'), '2026-11-16');
  assert.equal(c.instantDebut('2026-11-16'), Date.parse('2026-11-16T08:00:00Z'));
});

test('noms anglais et casse quelconque : même résultat qu en français', () => {
  assert.deepEqual(lireCycle({ jour: 'Monday', heureUTC: '08:00' }), lireCycle({ jour: 'lundi', heureUTC: '08:00' }));
  assert.deepEqual(lireCycle({ jour: 'SUNDAY', heureUTC: '10:00' }), CYCLE_DEFAUT);
  assert.equal(lireCycle({ jour: ' samedi ', heureUTC: '10:00' }).jourNum, 6);
  assert.equal(lireCycle({ jour: 'saturday', heureUTC: '10:00' }).jour, 'samedi');
});

test('minutes acceptées : début à 17:30 pile', () => {
  const c = cycle({ jour: 'mardi', heureUTC: '17:30' });
  assert.equal(c.debutSemaine('2026-11-17T17:29:59Z'), '2026-11-10');
  assert.equal(c.debutSemaine('2026-11-17T17:30:00Z'), '2026-11-17');
  assert.equal(c.instantDebut('2026-11-17'), Date.parse('2026-11-17T17:30:00Z'));
});

test('samedi 23:30 UTC (dimanche à Paris) : la clé de semaine est la date UTC, samedi', () => {
  const c = cycle({ jour: 'samedi', heureUTC: '23:30' });
  // 2026-11-21 est un samedi ; 2026-11-22 00:10 UTC est déjà dimanche à Paris mais reste dans la semaine ouverte samedi
  assert.equal(c.debutSemaine('2026-11-22T00:10:00Z'), '2026-11-21');
  assert.equal(c.debutSemaine('2026-11-21T23:29:59Z'), '2026-11-14');
  assert.equal(c.debutSemaine('2026-11-21T23:30:00Z'), '2026-11-21');
});

test('valeurs invalides : erreur claire, jamais de repli silencieux', () => {
  assert.throws(() => lireCycle({ jour: 'lunid', heureUTC: '08:00' }), /« jour »/);
  assert.throws(() => lireCycle({ jour: 'lundi', heureUTC: '8h' }), /« heureUTC »/);
  assert.throws(() => lireCycle({ jour: 'lundi', heureUTC: '25:00' }), /« heureUTC »/);
  assert.throws(() => lireCycle({ heureUTC: '08:00' }), /« jour »/);
  assert.throws(() => lireCycle({ jour: 'constructor', heureUTC: '08:00' }), /« jour »/);
  assert.throws(() => lireCycle('lundi'), /doit être un objet/);
  assert.throws(() => lireCycle(null), /doit être un objet/);
});
