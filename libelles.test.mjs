// Formateur de la page (bloc <script id="libelles"> de page/index.html, lot 2a de #17) : la page est publiée en un seul
// fichier, le test extrait donc le bloc et l'exécute (node:vm). Phrases attendues = celles qu'écrivait exporter.mjs
// avant le lot 2a (champ statut), recopiées telles quelles : l'écran ne doit pas bouger d'un caractère.
// Lancer : node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ETATS_HEBDO } from './lib/controles.mjs';

const html = readFileSync(new URL('./page/index.html', import.meta.url), 'utf8');
const bloc = html.match(/<script id="libelles">([\s\S]*?)<\/script>/);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(bloc[1], ctx);
const L = ctx.libelles;

// Ligne de plafondsHebdo telle que lib/hebdo.mjs l'écrit (valeurs par défaut de VIDE_HEBDO)
const h = champs => ({ semaine: '2026-10-18', etat: null, pct: null, enCours: false, projete100: false, fourchetteMin: null, fourchetteMax: null,
  fourchetteIncertaine: false, resetNote: null, coupeePremier: null, coupeeDepuis: null, indicatifDe: null, indicatifA: null,
  pctFin: null, horsEstime: null, ...champs });
// Dataset du Dashboard : valeurs parfois relues en texte (« true », « null », « 42 »)
const enTexte = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? 'null' : String(v)]));

const CAS = [
  ['atteint', h({ etat: 'atteint' }), 'atteint'],
  ['atteint, hors PC et fourchette', h({ etat: 'atteint', horsEstime: 10.9, pctFin: 100, fourchetteMin: 174, fourchetteMax: 190 }),
    'atteint, dont 10,9 pts hors de ce PC ; plafond entre 174 $ et 190 $'],
  ['plein', h({ etat: 'plein' }), 'atteint (relevé à 100 %)'],
  ['plein, hors PC', h({ etat: 'plein', horsEstime: 4, pctFin: 100 }), 'atteint (relevé à 100 %, dont 4 pts hors de ce PC)'],
  ['dépassée, semaine finie', h({ etat: 'depasse', pct: 80 }), 'pas atteint (projection à 80 % dépassée)'],
  ['dépassée, en cours', h({ etat: 'depasse', pct: 62, enCours: true }), 'en cours (projection à 62 % dépassée)'],
  ['projeté', h({ etat: 'projete', pct: 30 }), 'projeté (30 %)'],
  ['en cours, relevé sans plafond', h({ etat: 'enCours', pct: 8 }), 'en cours (8 %)'],
  ['en cours, sans relevé', h({ etat: 'enCours' }), 'en cours'],
  ['pas atteint, sans relevé', h({ etat: 'pasAtteint' }), 'pas atteint'],
  ['pas atteint, sans plafond', h({ etat: 'pasAtteint', pct: 40 }), 'pas atteint (fini à 40 %)'],
  ['pas atteint, 100 % projeté', h({ etat: 'pasAtteint', pct: 56, projete100: true }), 'pas atteint (fini à 56 %, 100 % projeté)'],
  ['fourchette incertaine, borne haute inconnue', h({ etat: 'enCours', pct: 20, horsEstime: 12.5, pctFin: 20, fourchetteMin: 150.4, fourchetteMax: null, fourchetteIncertaine: true }),
    'en cours (20 %, dont 12,5 pts hors de ce PC ; plafond incertain : entre 150 $ et ?)'],
  ['reset (ancienne forme)', h({ etat: 'reset', resetNote: 'reset du mardi' }), 'reset utilisé (reset du mardi)'],
  ['coupée puis indicatif', h({ etat: 'atteint', coupeePremier: '2026-10-20T12:00', coupeeDepuis: '2026-10-22T08:30', indicatifDe: 'Pro', indicatifA: 'Max 5x' }),
    'atteint ; coupée par reset hebdo le 20/10 12:00 UTC (segment retenu : depuis le 22/10 08:30) ; plafond indicatif : mêle deux forfaits (Pro → Max 5x)'],
  ['indicatif, forfait d\'avant inconnu', h({ etat: 'projete', pct: 50, indicatifDe: 'inconnu', indicatifA: 'Pro' }),
    'projeté (50 %) ; plafond indicatif : mêle deux forfaits (inconnu → Pro)'],
];

test('statutHebdo : même phrase qu\'avant le lot 2a, valeurs natives ou relues en texte', () => {
  for (const [nom, r, attendu] of CAS) {
    assert.equal(L.statutHebdo(r), attendu, nom);
    assert.equal(L.statutHebdo(enTexte(r)), attendu, `${nom} (texte)`);
  }
});

test('chaque état de controles.mjs a sa phrase dans la page (mêmes listes)', () => {
  assert.deepEqual([...L.ETATS], ETATS_HEBDO);
  for (const etat of ETATS_HEBDO) assert.doesNotMatch(L.statutHebdo(h({ etat, pct: 10, resetNote: 'x' })), /inconnu/, etat);
});

test('atteint : limite vue ou relevé à 100 %, rien d\'autre', () => {
  for (const etat of ETATS_HEBDO) assert.equal(L.atteint(h({ etat })), etat === 'atteint' || etat === 'plein', etat);
  assert.equal(L.atteint({ etat: 'atteint' }), true);
  assert.equal(L.atteint({ etat: 'projete', pct: 72 }), false);
});

test('plafonds5h, types, tranches', () => {
  assert.equal(L.statut5h({ etat: 'atteint', pct: null }), 'atteint');
  assert.equal(L.statut5h({ etat: 'projete', pct: 72 }), 'projeté (72 %)');
  assert.deepEqual(['cacheRead', 'cacheWrite', 'output', 'input'].map(L.type),
    ['Lecture du cache', 'Écriture en cache', 'Sortie (réponses + réflexion)', 'Entrée neuve']);
  assert.deepEqual([...L.TRANCHES].map(L.tranche), ['moins de 50k', '50k à 100k', '100k à 150k', '150k à 250k', 'plus de 250k']);
  assert.deepEqual([...L.GROS], ['150-250k', '250k+']);
});

test('repli : la page neuve sur un ancien export affiche la même chose', () => {
  assert.equal(L.statutHebdo({ statut: 'atteint, dont 3 pts hors de ce PC' }), 'atteint, dont 3 pts hors de ce PC');
  assert.equal(L.statut5h({ statut: 'projeté (60 %)' }), 'projeté (60 %)');
  assert.equal(L.atteint({ statut: 'atteint (relevé à 100 %)' }), true);
  assert.equal(L.atteint({ statut: 'projeté (60 %)' }), false);
  assert.equal(L.type('Lecture du cache'), 'Lecture du cache');
  assert.equal(L.codeTranche('150k à 250k'), '150-250k');
  assert.equal(L.tranche('plus de 250k'), 'plus de 250k');
});

test('page : plus aucune lecture directe de statut, type ou tranche hors du formateur', () => {
  const hors = html.replace(bloc[0], '');
  // Lectures d'un champ d'export brut : r.statut, d.type…, sauf à travers libelles.xxx(r.champ)
  const lectures = [...hors.matchAll(/(?<!libelles\.\w+\()\b\w+\.(statut|type|tranche)\b/g)].map(m => m[0])
    // libelles.type / libelles.tranche : le formateur lui-même ; x.type : Intl.DateTimeFormat.formatToParts, hors export
    .filter(s => !s.startsWith('libelles.') && s !== 'x.type');
  assert.deepEqual(lectures, []);
  // Anciens libellés comparés en dur (ex. tranche === '150k à 250k') : seulement dans le formateur
  for (const lib of ['moins de 50k', '150k à 250k', 'plus de 250k', 'Lecture du cache', "startsWith('atteint')", 'data-field="statut"'])
    assert.ok(!hors.includes(lib), lib);
});
