// Tests de la comparaison avec ccusage (17/11) : node --test comparer-ccusage.test.mjs
// Purs : ni ccusage ni données nécessaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparer } from './comparer-ccusage.mjs';

const jour = (date, n, cout) => ({ date, inputTokens: n, outputTokens: n, cacheCreationTokens: n, cacheReadTokens: n, totalCost: cout });
const ici = (n, cout) => ({ entree: n, sortie: n, ecritureCache: n, lectureCache: n, cout });

test('comparer : jour égal, écart de jetons, centime d\'arrondi, jour du passage ignoré', () => {
  const parJour = { '2026-11-14': ici(10, 1), '2026-11-15': ici(10, 1), '2026-11-16': ici(10, 1) };
  const daily = [jour('2026-11-14', 10, 1.004), jour('2026-11-15', 12, 1.5), jour('2026-11-16', 99, 9), jour('2026-11-17', 5, 1)];
  const { compares, ecarts } = comparer(parJour, daily, '2026-11-16');
  assert.equal(compares, 2);                                    // 16 et 17 : journaux encore écrits après agreger
  assert.equal(ecarts.length, 1);                               // 14 : même jetons, 0,004 $ d'écart toléré
  assert.equal(ecarts[0].jour, '2026-11-15');
  assert.deepEqual(ecarts[0].diffs, [['entrée', 2], ['sortie', 2], ['écriture cache', 2], ['lecture cache', 2]]);
  assert.deepEqual([ecarts[0].coutCc, ecarts[0].coutIci], [1.5, 1]);
});

test('comparer : jour absent d\'ici = tout en écart positif', () => {
  const { ecarts } = comparer({}, [jour('2026-11-10', 3, 0.5)], '2026-11-17');
  assert.deepEqual(ecarts[0].diffs.map(([, n]) => n), [3, 3, 3, 3]);
});
