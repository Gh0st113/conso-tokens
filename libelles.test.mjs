// Formateur et dictionnaire de la page (page/index.html) : la page est publiée en un seul fichier, le test extrait donc
// les blocs <script id="libelles"> (phrases), <script id="dico"> (LANGUES, DICO, tr) et les exécute (node:vm).
// Phrases attendues en français = celles qu'écrivait exporter.mjs avant le lot 2a (champ statut), recopiées telles quelles.
// Ajouter une langue : voir README, « Ajouter une langue ». Ces tests disent ce qui manque.
// Lancer : node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ETATS_HEBDO } from './lib/controles.mjs';
import { CAUSES } from './lib/agregats.mjs';

const html = readFileSync(new URL('./page/index.html', import.meta.url), 'utf8');
const bloc = (id) => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext('globalThis.window = globalThis;', ctx); // la page parle à window (LANGUES, tr… sont exposés dessus)
vm.runInContext(bloc('libelles'), ctx);
vm.runInContext(bloc('dico'), ctx);
const L = ctx.libelles;
const LANGUES = vm.runInContext('LANGUES', ctx);
const DICO = vm.runInContext('DICO', ctx);
const PHRASES = L.PHRASES;

// La page règle la langue (code de LANGUES) et ses formats ; le test fait pareil
const regler = (code) => { L.langue = code; L.formats = LANGUES[code]; };
regler('fr');

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

// Mêmes cas en anglais, écrits en dur (la seule langue hors fr dont le texte attendu est fixé ici)
const EN = [
  'reached', 'reached, of which 10.9 pts off this PC; cap between $174 and $190', 'reached (100 % reading)',
  'reached (100 % reading, of which 4 pts off this PC)', 'not reached (projection of 80 % exceeded)',
  'in progress (projection of 62 % exceeded)', 'projected (30 %)', 'in progress (8 %)', 'in progress', 'not reached',
  'not reached (ended at 40 %)', 'not reached (ended at 56 %, 100 % projected)',
  'in progress (20 %, of which 12.5 pts off this PC; cap uncertain: between $150 and ?)', 'reset used (reset du mardi)',
  'reached; cut by weekly reset on 10/20 12:00 UTC (segment kept: from 10/22 08:30); indicative cap: mixes two plans (Pro → Max 5x)',
  'projected (50 %); indicative cap: mixes two plans (inconnu → Pro)',
];

// Clés lues dans la page : textes du HTML (data-t, data-t-aria), variantes jetons (data-jet), appels tr('…') littéraux
const cles = (re, texte = html) => [...texte.matchAll(re)].map(m => m[1]);
const clesHtml = [...new Set([...cles(/ data-t="([^"]+)"/g), ...cles(/data-t-aria="([^"]+)"/g)])];
const clesJs = [...new Set(cles(/\btr\('([^']+)'\)/g))];
// Variante jetons : seulement pour un élément qui porte data-jet (une clé « cle.jet » sans data-jet serait morte)
const clesJet = [...new Set((html.match(/<\w+[^>]*data-jet="[^"]*"[^>]*>/g) ?? []).map(b => b.match(/data-t="([^"]+)"/)?.[1]).filter(Boolean))];

// Ce qui manque à une langue : phrases du formateur, types et tranches, textes du HTML et du JS (DICO).
// Renvoie la liste des manques ; liste vide = langue complète.
function manquants(langues, phrases, dico) {
  const probs = [];
  const ref = Object.keys(phrases.fr);
  for (const code of Object.keys(langues)) {
    const p = phrases[code];
    if (!p) { probs.push(`${code} : aucune phrase dans PHRASES`); continue; }
    const L = langues[code];
    for (const f of ['locale', 'decimal', 'sep']) if (typeof L[f] !== 'string') probs.push(`${code} : ${f} absent de LANGUES`);
    for (const f of ['monnaie', 'heureInfo', 'heureUTC']) if (typeof L[f] !== 'function') probs.push(`${code} : ${f} absent de LANGUES`);
    for (const k of ref) if (p[k] === undefined) probs.push(`${code} : phrase « ${k} »`);
    for (const t of ['types', 'tranches']) for (const k of Object.keys(phrases.fr[t])) if (p[t]?.[k] === undefined) probs.push(`${code} : ${t}.${k}`);
    if (code !== 'fr') for (const k of [...clesHtml, ...clesJet.map(c => c + '.jet')]) if (dico[k]?.[code] === undefined) probs.push(`${code} : « ${k} » (DICO)`);
    for (const k of clesJs) if (dico[k]?.[code] === undefined) probs.push(`${code} : tr « ${k} » (DICO)`);
  }
  return probs;
}

test('statutHebdo : même phrase qu\'avant le lot 2a, valeurs natives ou relues en texte', () => {
  regler('fr');
  for (const [nom, r, attendu] of CAS) {
    assert.equal(L.statutHebdo(r), attendu, nom);
    assert.equal(L.statutHebdo(enTexte(r)), attendu, `${nom} (texte)`);
  }
});

test('chaque état de controles.mjs a sa phrase dans la page (mêmes listes)', () => {
  regler('fr');
  assert.deepEqual([...L.ETATS], ETATS_HEBDO);
  for (const etat of ETATS_HEBDO) assert.doesNotMatch(L.statutHebdo(h({ etat, pct: 10, resetNote: 'x' })), /inconnu/, etat);
});

test('atteint : limite vue ou relevé à 100 %, rien d\'autre', () => {
  regler('fr');
  for (const etat of ETATS_HEBDO) assert.equal(L.atteint(h({ etat })), etat === 'atteint' || etat === 'plein', etat);
  assert.equal(L.atteint({ etat: 'atteint' }), true);
  assert.equal(L.atteint({ etat: 'projete', pct: 72 }), false);
});

test('plafonds5h, types, tranches (français)', () => {
  regler('fr');
  assert.equal(L.statut5h({ etat: 'atteint', pct: null }), 'atteint');
  assert.equal(L.statut5h({ etat: 'projete', pct: 72 }), 'projeté (72 %)');
  assert.deepEqual(['cacheRead', 'cacheWrite', 'output', 'input'].map(L.type),
    ['Lecture du cache', 'Écriture en cache', 'Sortie (réponses + réflexion)', 'Entrée neuve']);
  assert.deepEqual([...L.TRANCHES].map(L.tranche), ['moins de 50k', '50k à 100k', '100k à 150k', '150k à 250k', 'plus de 250k']);
  assert.deepEqual([...L.GROS], ['150-250k', '250k+']);
});

test('repli : la page neuve sur un ancien export affiche la même chose (français)', () => {
  regler('fr');
  assert.equal(L.statutHebdo({ statut: 'atteint, dont 3 pts hors de ce PC' }), 'atteint, dont 3 pts hors de ce PC');
  assert.equal(L.statut5h({ statut: 'projeté (60 %)' }), 'projeté (60 %)');
  assert.equal(L.atteint({ statut: 'atteint (relevé à 100 %)' }), true);
  assert.equal(L.atteint({ statut: 'projeté (60 %)' }), false);
  assert.equal(L.type('Lecture du cache'), 'Lecture du cache');
  assert.equal(L.codeTranche('150k à 250k'), '150-250k');
  assert.equal(L.tranche('plus de 250k'), 'plus de 250k');
});

test('anglais : mêmes cas, phrases anglaises (valeurs natives et relues en texte)', () => {
  regler('en');
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
    assert.equal(L.codeTranche('150k to 250k'), '150-250k');
  } finally { regler('fr'); }
});

test('toutes les langues de LANGUES : chaque état a sa phrase, types et tranches traduits', () => {
  for (const code of Object.keys(LANGUES)) {
    regler(code);
    for (const etat of ETATS_HEBDO) assert.doesNotMatch(L.statutHebdo(h({ etat, pct: 10, resetNote: 'x', horsEstime: 2, pctFin: 50 })), /inconnu|unknown state/, `${code} ${etat}`);
    for (const t of ['cacheRead', 'cacheWrite', 'output', 'input']) assert.notEqual(L.type(t), t, `${code} type ${t}`);
    for (const t of L.TRANCHES) assert.notEqual(L.tranche(t), t, `${code} tranche ${t}`);
  }
  regler('fr');
});

test('formateur : les codes qu\'il sait écrire sont exactement ceux de LANGUES', () => {
  assert.deepEqual([...L.CODES].sort(), Object.keys(LANGUES).sort());
});

test('complétude : chaque langue de LANGUES a ses phrases, ses textes du HTML et ses tr()', () => {
  assert.deepEqual(manquants(LANGUES, PHRASES, DICO), []);
});

test('complétude : une fausse langue xx (copie, jamais dans la page) est signalée comme incomplète', () => {
  const faux = { ...LANGUES, xx: { locale: 'xx-XX', decimal: '.', monnaie: n => n, sep: ': ', heureInfo: s => s, heureUTC: (hh, m) => `${hh}:${m}` } };
  const probs = manquants(faux, PHRASES, DICO);
  assert.ok(probs.length > 0, 'la langue incomplète doit être signalée');
  assert.ok(probs.every(p => p.startsWith('xx :')), probs.slice(0, 3).join(' | '));
  assert.ok(probs.some(p => p.includes('aucune phrase')), 'xx sans PHRASES');
});

test('défaut : la langue de repli est une langue de LANGUES', () => {
  assert.ok(Object.hasOwn(LANGUES, vm.runInContext('LANGUE_PAR_DEFAUT', ctx)));
});

test('page : aucune langue en dur hors des tables (LANGUES, PHRASES, DICO) ; seulement fr et en', () => {
  const sansTables = html.replace(/const LANGUES = \{[\s\S]*?\n {2}\};/, '').replace(/\n {4}const PHRASES = \{[\s\S]*?\n {4}\};/, '');
  assert.doesNotMatch(sansTables, /=== 'en'|=== 'fr'|'en-US'|'fr-FR'|\? 'en'|\? 'fr'/);
  assert.doesNotMatch(sansTables, /data-langue="(fr|en)"/, 'boutons de langue en dur');
  assert.deepEqual(Object.keys(LANGUES).sort(), ['en', 'fr']);
});

test('page : plus aucune lecture directe de statut, type ou tranche hors du formateur', () => {
  const hors = html.replace(bloc('libelles'), '');
  // Lectures d'un champ d'export brut : r.statut, d.type…, sauf à travers libelles.xxx(r.champ)
  const lectures = [...hors.matchAll(/(?<!libelles\.\w+\()\b\w+\.(statut|type|tranche)\b/g)].map(m => m[0])
    // libelles.type / libelles.tranche : le formateur lui-même ; x.type : Intl.DateTimeFormat.formatToParts, hors export
    .filter(s => !s.startsWith('libelles.') && s !== 'x.type');
  assert.deepEqual(lectures, []);
  // Anciens libellés comparés en dur (ex. tranche === '150k à 250k') : seulement dans le formateur
  for (const lib of ['moins de 50k', '150k à 250k', 'plus de 250k', 'Lecture du cache', "startsWith('atteint')", 'data-field="statut"'])
    assert.ok(!hors.includes(lib), lib);
});

test('dictionnaire : un texte du HTML n\'a pas de français ; chaque langue hors fr a sa clé ; tr() a fr et en', () => {
  for (const k of clesHtml) assert.equal(DICO[k]?.fr, undefined, `${k} : une entrée du HTML n'a pas de fr`);
  for (const k of clesJet.map(c => c + '.jet')) assert.equal(DICO[k]?.fr, undefined, `${k} : une entrée .jet n'a pas de fr`);
  for (const k of [...clesHtml, ...clesJet.map(c => c + '.jet')]) {
    assert.ok(DICO[k], `${k} : pas d'entrée`);
    for (const code of Object.keys(LANGUES)) if (code !== 'fr') assert.ok(DICO[k][code] !== undefined, `${k} : pas de ${code}`);
  }
  for (const k of clesJs) assert.ok(DICO[k]?.fr !== undefined && DICO[k]?.en !== undefined, `tr('${k}') : fr et en requis`);
  // tr() ne reçoit que des clés écrites en dur : cherché dans la page entière (scripts compris)
  assert.equal([...html.matchAll(/\btr\(([^')][^)]*)\)/g)].length, 0, 'tr() avec une clé non littérale');
});

test('dictionnaire : aucune clé morte (chaque entrée est utilisée)', () => {
  const usees = new Set([...clesHtml, ...clesJs, ...clesJet.map(c => c + '.jet')]);
  assert.deepEqual(Object.keys(DICO).filter(k => !usees.has(k)), [], 'entrées mortes');
});

test('anglais : aucune lettre accentuée française ni guillemets français', () => {
  for (const [k, v] of Object.entries(DICO)) {
    if (v.en === undefined) continue;
    assert.doesNotMatch(v.en, /[éèàùçêôî«»]/, k);
  }
  for (const [k, v] of Object.entries(PHRASES.en.types)) assert.doesNotMatch(v, /[éèàùçêôî«»]/, k);
});

test('data-t : texte seul (aucun enfant, donc aucun data-draw ou data-source effacé)', () => {
  const corps = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const m of corps.matchAll(/<(\w+)[^>]*\sdata-t="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
    assert.doesNotMatch(m[2], /</, `data-t sur un élément qui contient un enfant : ${m[2].slice(0, 60)}`);
  }
});

// Plateforme (artefact Dashboard) : elle perd les barres obliques inverses des scripts (un \' devient une chaîne non
// fermée, une regex est altérée en silence). Aucune dans un <script> : apostrophe typographique, [0-9], pas de regex.
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1].trim(), corps: m[2] }));
test('scripts : aucune barre oblique inverse dans un <script> de la page', () => {
  const barre = '\\';
  for (const [i, s] of scripts.entries()) {
    const lignes = s.corps.split('\n').filter(l => l.includes(barre)).map(l => l.trim().slice(0, 80));
    assert.deepEqual(lignes, [], `script n° ${i + 1} (${s.attrs || 'sans id'})`);
  }
});

// Plateforme : chaque <script> a sa propre portée. Un const de #dico n'est pas visible d'un script suivant : ce qui
// est partagé passe par window. On exécute libelles et dico, chacun dans sa fonction, puis on vérifie window.
test('scripts : chaque script dans sa propre portée ; LANGUES, LANGUE_PAR_DEFAUT, DICO, tr et libelles sur window', () => {
  const w = vm.createContext({});
  vm.runInContext('globalThis.window = globalThis;', w);
  for (const s of scripts.filter(s => s.attrs === 'id="libelles"' || s.attrs === 'id="dico"')) {
    vm.runInContext(`(function () {\n${s.corps}\n})();`, w);
  }
  for (const nom of ['LANGUES', 'LANGUE_PAR_DEFAUT', 'DICO', 'tr', 'jourSemaine', 'libelles']) {
    assert.notEqual(vm.runInContext(`typeof window.${nom}`, w), 'undefined', `window.${nom} absent`);
  }
});

// Montant FR du plafond : milliers groupés comme CC.usd (espace fine insécable U+202F), montant < 1000 inchangé
test('monnaie FR : 1000 $ groupé comme CC.usd ; 174 $ inchangé', () => {
  assert.equal(LANGUES.fr.monnaie(1000), '1 000 $');
  assert.equal(LANGUES.fr.monnaie(12345), '12 345 $');
  assert.equal(LANGUES.fr.monnaie(174), '174 $');
});

// Infobulle du graphe par semaine : le jour se calcule depuis le début de la semaine (cycle variable)
test('jour de semaine : dimanche et mardi, en fr et en', () => {
  const jourSemaine = vm.runInContext('jourSemaine', ctx);
  assert.equal(jourSemaine('2026-11-15', 'fr'), 'dim. 15 nov.');
  assert.equal(jourSemaine('2026-11-17', 'fr'), 'mar. 17 nov.');
  assert.equal(jourSemaine('2026-11-15', 'en'), 'Sun, Nov 15');
});

test('infobulle semaine : « Semaine du » / « Week of » (le jour vient du cycle, pas du texte)', () => {
  assert.equal(DICO['tip.semaine'].fr, 'Semaine du');
  assert.equal(DICO['tip.semaine'].en, 'Week of');
});

// #32 : horsEstime / pctFin relus en texte (« null ») ne doivent plus donner « ≈ null pts sur null % »
test('vide : null, « », « null » ; 0 et « 0 » ne sont pas vides', () => {
  for (const v of [null, undefined, '', 'null']) assert.equal(L.vide(v), true, String(v));
  for (const v of [0, '0', 4, '10.9']) assert.equal(L.vide(v), false, String(v));
});

test('CC.horsPC (#32) : vide en texte ou en null → rien ; sinon « ≈ N pts sur P % »', () => {
  // Le bloc CC n'est pas exécutable seul (dash, d3) : on n'en extrait que CC.dec et CC.horsPC
  const extrait = (debut, fin) => { const i = html.indexOf(debut); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const c = { libelles: L, tr: ctx.tr, LANGUES, CC: { langue: 'fr' } };
  vm.createContext(c);
  vm.runInContext(extrait('CC.dec = ', ';'), c);
  vm.runInContext(extrait('CC.horsPC = ', '%`;'), c);
  const hors = c.CC.horsPC;
  assert.equal(hors(enTexte(h({}))), '');
  assert.equal(hors(h({})), '');
  assert.equal(hors(enTexte(h({ horsEstime: 10.9, pctFin: 100 }))), '≈ 10,9 pts sur 100 %');
  assert.equal(hors(h({ horsEstime: 4, pctFin: 98 })), '≈ 4 pts sur 98 %');
  // Un seul des deux champs vide (en texte ou non) : rien non plus
  assert.equal(hors(enTexte(h({ horsEstime: 4 }))), '');
  assert.equal(hors({ ...h({ pctFin: 100 }), horsEstime: 'null' }), '');
  assert.equal(hors({ ...h({ horsEstime: 4 }), pctFin: '' }), '');
  c.CC.langue = 'en';
  regler('en');
  assert.equal(hors(h({ horsEstime: 10.9, pctFin: 100 })), '≈ 10.9 pts of 100 %');
  regler('fr');
  assert.ok(!html.includes('r.horsEstime == null'), 'plus de test « == null » sur horsEstime dans la page');
});

// #18 : l'infobulle par semaine ne liste que les modèles utilisés cette semaine-là (plus de « Fable : 0 $ »)
test('infobulle semaine (#18) : séries filtrées sur la valeur de la semaine survolée', () => {
  // Le filtre est extrait de la page et exécuté sur une semaine où Fable et Opus 4.8 valent 0
  const debut = '...SERIES.filter(', fin = ').map(([c, n, ci]) => [CC.couleur(ci), n, CC.fmt(Number(r[CC.serie(c)]))])';
  const i = html.indexOf(debut), j = html.indexOf(fin, i);
  assert.ok(i > 0 && j > i, 'filtre de l’infobulle par semaine introuvable');
  const c = { CC: { jetons: false } };
  vm.createContext(c);
  vm.runInContext(`CC.serie = c => CC.jetons ? 'j' + c : c;`, c);
  const filtre = vm.runInContext(`(SERIES, r) => SERIES.filter(${html.slice(i + debut.length, j)}).map(s => s[0])`, c);
  const SERIES = [['opus55'], ['opus48'], ['sonnet'], ['fable']];
  const r = { opus55: '12.5', opus48: 0, sonnet: 3, fable: '0', jopus55: 900, jopus48: 0, jsonnet: 0, jfable: 40 };
  assert.deepEqual(filtre(SERIES, r), ['opus55', 'sonnet']);
  c.CC.jetons = true;
  assert.deepEqual(filtre(SERIES, r), ['opus55', 'fable']);
});

// #33 : les titres et descriptions des calculs (dash.calc) sont lus par la plateforme, pas par le bouton FR / EN :
// une seule langue, l'anglais (celle du dépôt)
test('calculs (#33) : titres et descriptions de dash.calc en anglais', () => {
  const calculs = html.split("dash.calc('").slice(1).map(s => {
    const champ = nom => { const i = s.indexOf(nom + ": '") + nom.length + 3; return s.slice(i, s.indexOf("',", i)); };
    return [s.slice(0, s.indexOf("'")), champ('title'), champ('description')];
  });
  assert.deepEqual(calculs.map(c => c[0]), ['totaux', 'semCourante', 'partOpus', 'grosContexte', 'ctxPeriodes']);
  // Chaînes exactes : un titre changé doit l’être ici aussi (et rester fidèle à ce que calcule fn)
  assert.deepEqual(calculs.map(c => c.slice(1)), [
    ['Totals since the start', 'Cost, tokens and replies summed over all weeks.'],
    ['Current and previous week', 'Cost and tokens of the last plan week and of the week before.'],
    ['Opus share of the cost', 'Opus models divided by the total, in cost and in tokens.'],
    ['Calls above 150k', 'Share of calls whose context exceeds 150,000 tokens.'],
    ['Calls above 150k by period', 'Same share as the top tile, over the last 7 and 30 days of data and across all data.'],
  ]);
});

test('reconstructions : chaque cause de lib/agregats.mjs a son libellé dans chaque langue', () => {
  assert.deepEqual([...L.CAUSES], CAUSES);
  for (const code of Object.keys(LANGUES)) {
    regler(code);
    for (const c of CAUSES) assert.notEqual(L.cause(c), c, `${code} cause ${c}`);
  }
  regler('fr');
  assert.equal(L.cause('compactage'), 'après un compactage');
});
