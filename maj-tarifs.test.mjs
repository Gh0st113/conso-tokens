// Tests de maj-tarifs.mjs (13/11) : node --test maj-tarifs.test.mjs
// Partent d'une copie de la page Pricing (tests-pricing-20261113.md), puis la cassent d'une seule façon par test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireTarifs } from './maj-tarifs.mjs';

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tests-pricing-20261113.md'), 'utf8');
const ligne = nom => page.split('\n').find(l => l.startsWith(`| Claude ${nom} `));

test('page réelle : tarifs des modèles utilisés et palier Haiku 5.5', () => {
  const { tarifs, paliers } = lireTarifs(page);
  assert.deepEqual(tarifs['Opus 5.5'], [4, 20, 0.2]);
  assert.deepEqual(tarifs['Sonnet 5.5'], [2, 10, 0.1]);
  assert.deepEqual(tarifs['Fable 5.2'], [8, 40, 0.2]);
  assert.deepEqual(tarifs['Opus 4.6'], [5, 25, 0.5]);
  assert.deepEqual(tarifs['Haiku 5.5'], [0.1, 0.5, 0.01]);       // ligne « up to » = tarif de base
  assert.deepEqual(paliers['Haiku 5.5'], { seuil: 100000, tarif: [0.5, 2.5, 0.05] });
  assert.equal(tarifs['Opus 4.1'][0], 15);                        // nom « (retired, …) » nettoyé
});

test('colonnes réordonnées : lues par en-tête, mêmes prix', () => {
  const echange = l => { const c = l.split('|'); [c[2], c[6]] = [c[6], c[2]]; return c.join('|'); };
  const lignes = page.split('\n'), i = lignes.findIndex(l => l.startsWith('| Model'));
  let j = i; while (lignes[j]?.startsWith('|')) { lignes[j] = echange(lignes[j]); j++; }
  assert.deepEqual(lireTarifs(lignes.join('\n')).tarifs['Opus 5.5'], [4, 20, 0.2]);
});

test('colonne inconnue : refus', () => {
  assert.throws(() => lireTarifs(page.replace('| Output tokens', '| Output tokens (batch)').replace('Output tokens (batch)', 'Sortie')), /colonne inconnue/);
});

test('écriture cache hors 1,25 × / 2 × : refus', () => {
  const l = ligne('Opus 5.5');
  assert.throws(() => lireTarifs(page.replace(l, l.replace('$8 / MTok', '$6 / MTok'))), /écriture cache/);
});

test('palier écrit autrement (« over 100K ») : refus, pas d’écrasement du tarif de base', () => {
  const l = ligne('Haiku 5.5 (for prompts over');
  assert.throws(() => lireTarifs(page.replace(l, l.replace('100,000', '100K'))), /palier non reconnu/);
});

test('prix illisible : refus', () => {
  const l = ligne('Sonnet 5.5');
  assert.throws(() => lireTarifs(page.replace(l, l.replace('$10 / MTok', 'TBD'))), /prix illisible/);
});

test('modèle en double : refus', () => {
  const l = ligne('Opus 4.8');
  assert.throws(() => lireTarifs(page.replace(l, l + '\n' + l)), /en double/);
});

test('note <sup> dans le nom : nettoyée', () => {
  const l = ligne('Opus 4.7');
  assert.deepEqual(lireTarifs(page.replace(l, l.replace('Claude Opus 4.7', 'Claude Opus 4.7<sup>4</sup>'))).tarifs['Opus 4.7'], [5, 25, 0.5]);
});

test('section absente : refus', () => {
  assert.throws(() => lireTarifs(page.replace('## Model pricing', '## Prices')), /introuvable/);
});
