// Tests des contrôles (13/11) : node --test controles.test.mjs
// Partent des vraies sorties (donnees.json + export/ du dossier des données), puis cassent une seule chose par test.
// Sans données (dépôt tout juste cloné) : tests sautés ; lancer d'abord node agreger.mjs puis node exporter.mjs.
// Un test qui demande plus d'historique que vos données n'en ont (ex. 4 semaines, 3 pentes) est sauté, pas échoué.
import { test as tester } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES } from './config.mjs';
import { controler, rapport } from './controles.mjs';

const ici = DONNEES;
const sansDonnees = !existsSync(join(ici, 'donnees.json')) || !existsSync(join(ici, 'export'));
const lire = () => {
  const d = JSON.parse(readFileSync(join(ici, 'donnees.json'), 'utf8'));
  const tables = Object.fromEntries(readdirSync(join(ici, 'export')).filter(f => f.endsWith('.json'))
    .map(f => [f.slice(0, -5), JSON.parse(readFileSync(join(ici, 'export', f), 'utf8'))]));
  return { d, tables };
};
const base = sansDonnees ? null : lire();
// besoin(données) : faux = pas assez d'historique pour ce test → sauté
const test = (nom, fn, besoin = () => true) => tester(nom,
  { skip: sansDonnees ? 'pas de données : lancer agreger.mjs puis exporter.mjs' : !besoin(base) && 'pas assez de données pour ce test' }, fn);
const n = (table, min = 1) => x => (x.tables[table]?.length ?? 0) >= min;
// Groupes de modèles = colonnes de « semaines » qui ont une jumelle « j… » (jetons), comme les écrit exporter.mjs
const GROUPES = (() => {
  const cles = new Set((base?.tables.semaines ?? []).flatMap(Object.keys));
  return [...cles].filter(k => !['debut', 'cout', 'appels', 'jetons', 'manque'].includes(k) && cles.has('j' + k));
})();
// « Maintenant » = heure de génération de donnees.json (l'export suit dans la même commande) : même semaine que l'export
const maintenantDe = d => Date.parse(d.genereLe);
const verifier = ({ d, tables }, opts = {}) => controler(d, tables, { maintenant: maintenantDe(d), groupes: GROUPES, ...opts });

test('vraies données : CONTRÔLES : OK', () => {
  const r = verifier(lire());
  assert.equal(rapport(r), 'CONTRÔLES : OK', rapport(r));
});

test('total absent : une anomalie au lieu de contrôles muets', () => {
  const x = lire(); x.d.total.cout = undefined;
  assert.match(verifier(x).anomalies[0], /total\.cout/);
});

test('coût manquant dans une ligne', () => {
  const x = lire(); delete x.tables.modeles[0].cout;
  assert.ok(verifier(x).anomalies.some(a => a.includes('« modeles » : 1 ligne(s) sans cout')));
}, n('modeles'));

test('appels qui ne retombent pas sur le total', () => {
  const x = lire(); x.tables.sessions[0].appels += 1;
  assert.ok(verifier(x).anomalies.some(a => a.includes('somme appels de « sessions »')));
}, n('sessions'));

test('coût négatif', () => {
  const x = lire(); x.tables.jours[0].cout = -1;
  assert.ok(verifier(x).anomalies.some(a => a.includes('jours[0].cout = -1 (négatif)')));
}, n('jours'));

test('modèle avec tarif mais coût nul', () => {
  const x = lire(); const m = Object.keys(x.d.parModele).find(m => x.d.tarifs?.[m]); x.d.parModele[m].cout = 0;
  assert.ok(verifier(x).anomalies.some(a => a.includes(`modèle « ${m} » :`)));
}, x => Object.keys(x.d.parModele ?? {}).some(m => x.d.tarifs?.[m]));

test('consommé du comparatif ≠ coût de la semaine', () => {
  const x = lire(); x.tables.plafondsHebdo[3].consomme += 5;
  assert.ok(verifier(x).anomalies.some(a => a.includes('≠ coût de la semaine')));
}, n('plafondsHebdo', 4));

test('semaine intermédiaire absente du comparatif', () => {
  const x = lire(); x.tables.plafondsHebdo.splice(2, 1);
  assert.ok(verifier(x).anomalies.some(a => a.includes('semaines du comparatif hebdo')));
}, n('plafondsHebdo', 4));

test('statut absent : anomalie, pas plantage', () => {
  const x = lire(); delete x.tables.plafondsHebdo[0].statut;
  assert.ok(verifier(x).anomalies.some(a => a.includes('statut absent')));
}, n('plafondsHebdo'));

test('NaN dans une table', () => {
  const x = lire(); x.tables.jours[0].cout = NaN;
  assert.ok(verifier(x).anomalies.some(a => a.includes('jours[0].cout = NaN')));
}, n('jours'));

test('null hors champ d’estimation', () => {
  const x = lire(); x.tables.sessions[0].cout = null;
  assert.ok(verifier(x).anomalies.some(a => a.includes('sessions[0].cout = null')));
}, n('sessions'));

test('null permis sur plafond', () => {
  const x = lire(); x.tables.plafondsHebdo.at(-1).plafond = null;
  assert.ok(!verifier(x).anomalies.some(a => a.includes('plafond = null')));
}, n('plafondsHebdo'));

test('total d’une table qui ne retombe pas juste', () => {
  const x = lire(); x.tables.projets[0].cout += 1;
  assert.ok(verifier(x).anomalies.some(a => a.includes('« projets »')));
}, n('projets'));

test('groupe de modèles qui ne retombe pas sur la semaine (ex. Fable compté nulle part)', () => {
  const x = lire(); const s = x.tables.semaines.at(-1); s[GROUPES[0]] = (s[GROUPES[0]] ?? 0) + 1; // un groupe qui ne retombe plus sur la semaine
  assert.ok(verifier(x).anomalies.some(a => a.includes(`semaine ${s.debut} : groupes`)));
}, x => n('semaines')(x) && GROUPES.length > 0);

test('modèle sans tarif', () => {
  const x = lire(); x.d.parModele['Truc 9'] = { cout: 0 };
  assert.ok(verifier(x).anomalies.some(a => a.includes('« Truc 9 » sans tarif')));
});

test('statut et colonne hors PC en désaccord', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.find(r => r.horsEstime != null); r.horsEstime = 11;
  assert.ok(verifier(x).anomalies.some(a => a.includes(`semaine ${r.semaine} : statut dit`)));
}, x => (x.tables.plafondsHebdo ?? []).some(r => r.horsEstime != null));

test('% du statut différent de pctFin', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  r.statut = 'en cours (81 %, dont 10 pts hors de ce PC)'; r.horsEstime = 10; r.pctFin = 86; // ligne construite, pas de sortie anticipée
  assert.ok(verifier(x).anomalies.some(a => a.includes('colonne pctFin')));
}, n('plafondsHebdo'));

test('plafond affiché inférieur au consommé', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1); r.statut = 'projeté (50 %)'; r.plafond = r.consomme - 10; r.horsEstime = null; r.pctFin = null;
  assert.ok(verifier(x).anomalies.some(a => a.includes('> plafond')));
}, n('plafondsHebdo'));

test('semaine en cours absente du comparatif', () => {
  const x = lire(); x.tables.plafondsHebdo.pop();
  assert.ok(verifier(x).anomalies.some(a => a.includes('semaine en cours')));
}, n('plafondsHebdo', 2));

test('pente invalide', () => {
  const x = lire(); x.tables.pentes[0].ecart = 3;
  assert.ok(verifier(x).anomalies.some(a => a.startsWith('pentes[0]')));
}, n('pentes'));

test('plafond récent invraisemblable → à vérifier, pas anomalie', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  const haut = Math.max(5000, Math.ceil(r.consomme + 1000)) + 7; // au-dessus du consommé : pas d'anomalie « > plafond »
  r.plafond = haut; r.statut = 'projeté (90 %)'; r.horsEstime = null; r.pctFin = null;
  const v = verifier(x);
  assert.ok(v.aVerifier.some(a => a.includes(`plafond de la semaine ${r.semaine} = ${haut} $`)));
  assert.ok(!v.anomalies.some(a => a.includes(String(haut))));
}, x => n('plafondsHebdo')(x) && x.tables.pentes.filter(p => !p.silence).length >= 3);

test('vieille pente hors bande : ignorée (historique connu)', () => {
  const x = lire();
  const max = Math.max(...x.tables.pentes.filter(p => !p.silence).map(p => p.plafond));
  const vieille = Math.round(max * 30) + 1, recente = Math.round(max * 3) + 1; // la médiane reste ≤ max : 3 × max est hors bande
  x.tables.pentes.unshift({ debut: '2000-01-01T10:00', fin: '2000-01-02T10:00', ecart: 10, heures: 24, plafond: vieille, silence: false });
  x.tables.pentes.push({ debut: x.tables.plafondsHebdo.at(-1).semaine + 'T12:00', fin: x.tables.plafondsHebdo.at(-1).semaine + 'T20:00', ecart: 10, heures: 8, plafond: recente, silence: false });
  const v = verifier(x).aVerifier;
  assert.ok(!v.some(a => a.includes(`${vieille} $`)), 'l’ancienne pente doit être ignorée');
  assert.ok(v.some(a => a.includes(`${recente} $`)), 'la pente récente doit être signalée');
}, x => n('plafondsHebdo')(x) && x.tables.pentes.filter(p => !p.silence).length >= 3);

test('sonar muet depuis plus de 24 h alors que le PC consomme', () => {
  const x = lire();
  // 30 h après le dernier relevé, avec une consommation ce jour-là
  x.tables.jours.push({ jour: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenantDe(x.d) + 30 * 36e5), cout: 5, appels: 1, jetons: 1, manque: '' });
  const w = controler(x.d, x.tables, { maintenant: maintenantDe(x.d) + 30 * 36e5, groupes: GROUPES });
  assert.ok(w.aVerifier.some(a => a.includes('sonar muet')));
}, x => (x.d.projections ?? []).some(p => p.type === 'hebdo'));
