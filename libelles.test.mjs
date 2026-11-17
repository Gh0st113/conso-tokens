// Formateur de la page (bloc <script id="libelles"> de page/index.html, lot 2a de #17) : la page est publiée en un seul
// fichier, le test extrait donc le bloc et l'exécute (node:vm). Phrases attendues = celles qu'écrivait exporter.mjs
// avant le lot 2a (champ statut), recopiées telles quelles : l'écran ne doit pas bouger d'un caractère.
// Lancer : node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ETATS_HEBDO } from './controles.mjs';

const html = readFileSync(new URL('./page/index.html', import.meta.url), 'utf8');
const bloc = html.match(/<script id="libelles">([\s\S]*?)<\/script>/);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(bloc[1], ctx);
const L = ctx.libelles;

// Ligne de plafondsHebdo telle qu'exporter.mjs l'écrit (valeurs par défaut de VIDE_HEBDO)
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

// Lot 2b (17/11) : la page existe aussi en anglais. Phrases anglaises attendues (écrites en dur), puis cohérence
// du dictionnaire DICO (page/index.html) et invariant « data-t = texte seul ».
const EN = [
  'reached', 'reached, of which 10.9 pts off this PC ; cap between $174 and $190', 'reached (100 % reading)',
  'reached (100 % reading, of which 4 pts off this PC)', 'not reached (projection of 80 % exceeded)',
  'in progress (projection of 62 % exceeded)', 'projected (30 %)', 'in progress (8 %)', 'in progress', 'not reached',
  'not reached (ended at 40 %)', 'not reached (ended at 56 %, 100 % projected)',
  'in progress (20 %, of which 12.5 pts off this PC ; cap uncertain: between $150 and ?)', 'reset used (reset du mardi)',
  'reached ; cut by weekly reset on 20/10 12:00 UTC (segment kept: from 22/10 08:30) ; indicative cap: mixes two plans (Pro → Max 5x)',
  'projected (50 %) ; indicative cap: mixes two plans (inconnu → Pro)',
];
test('anglais : mêmes cas, phrases anglaises (valeurs natives et relues en texte)', () => {
  L.langue = 'en';
  try {
    CAS.forEach(([nom, r], i) => {
      assert.equal(L.statutHebdo(r), EN[i], nom);
      assert.equal(L.statutHebdo(enTexte(r)), EN[i], `${nom} (texte)`);
    });
    assert.equal(L.statut5h({ etat: 'projete', pct: 72 }), 'projected (72 %)');
    assert.deepEqual(['cacheRead', 'cacheWrite', 'output', 'input'].map(L.type),
      ['Cache read', 'Cache write', 'Output (replies + reasoning)', 'Fresh input']);
    assert.deepEqual([...L.TRANCHES].map(L.tranche), ['under 50k', '50k to 100k', '100k to 150k', '150k to 250k', 'over 250k']);
    // Repli d'un ancien export : la phrase française s'affiche telle quelle, sans erreur
    assert.equal(L.statutHebdo({ statut: 'atteint, dont 3 pts hors de ce PC' }), 'atteint, dont 3 pts hors de ce PC');
    assert.equal(L.type('Lecture du cache'), 'Cache read');
  } finally { L.langue = 'fr'; }
});

const dicoSrc = html.match(/const DICO = (\{[\s\S]*?\n {2}\});/)[1];
const DICO = vm.runInNewContext('(' + dicoSrc + ')');
const corps = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
const cles = (re) => [...html.matchAll(re)].map(m => m[1]);
const dataT = cles(/ data-t="([^"]+)"/g);
const dataTAria = cles(/data-t-aria="([^"]+)"/g);
const trLitteraux = cles(/\btr\('([^']+)'\)/g);
const cleJets = html.match(/<\w+[^>]*data-jet="[^"]*"[^>]*>/g) ?? [];

test('dictionnaire : chaque clé du HTML a son EN ; chaque tr(…) a FR et EN ; aucune clé morte', () => {
  for (const k of [...dataT, ...dataTAria]) assert.ok(DICO[k]?.en !== undefined, `${k} : pas d'entrée en`);
  for (const k of dataT) if (DICO[k]) assert.equal(DICO[k].fr, undefined, `${k} : un texte du HTML n'a que son en`);
  for (const k of dataTAria) assert.equal(DICO[k].fr, undefined, `${k} (aria)`);
  // Chaque élément data-jet a son entrée jetons, en anglais seulement
  for (const b of cleJets) { const k = b.match(/data-t="([^"]+)"/)?.[1]; assert.ok(k, `data-jet sans data-t : ${b.slice(0, 80)}`); assert.ok(DICO[k + '.jet']?.en !== undefined, `${k}.jet`); }
  for (const k of trLitteraux) { assert.ok(DICO[k]?.fr !== undefined && DICO[k]?.en !== undefined, `tr('${k}') : fr et en requis`); }
  assert.equal([...corps.matchAll(/\btr\(([^')][^)]*)\)/g)].length, 0, 'tr() avec une clé non littérale');
  // Pas de clé morte : chaque entrée est utilisée (directement, ou comme variante .jet d'une clé du HTML)
  const usees = new Set([...dataT, ...dataTAria, ...trLitteraux, ...dataT.map(k => k + '.jet')]);
  assert.deepEqual(Object.keys(DICO).filter(k => !usees.has(k)), [], 'entrées mortes');
});

test('anglais : aucune lettre accentuée française ni guillemets français', () => {
  for (const [k, v] of Object.entries(DICO)) {
    if (v.en === undefined) continue;
    assert.doesNotMatch(v.en, /[éèàùçêôî«»]/, k);
  }
});

test('data-t : texte seul (aucun enfant, donc aucun data-draw ou data-source effacé)', () => {
  for (const m of corps.matchAll(/<(\w+)[^>]*\sdata-t="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
    assert.doesNotMatch(m[2], /</, `data-t sur un élément qui contient un enfant : ${m[2].slice(0, 60)}`);
  }
});
