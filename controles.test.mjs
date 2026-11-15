// Tests des contrôles (13/11) : node --test controles.test.mjs
// Partent des vraies sorties (donnees.json + export/ du dossier des données), puis cassent une seule chose par test.
// Sans données (dépôt tout juste cloné) : tests sautés ; lancer d'abord node agreger.mjs puis node exporter.mjs.
// Un test qui demande plus d'historique que vos données n'en ont (ex. 4 semaines, 3 pentes) est sauté, pas échoué.
import { test as tester } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES, REMISE_A_ZERO } from './config.mjs';
import { fabriquer } from './semaine.mjs';
import { controler, rapport, suffixeCoupee, forfaitDe, SUFFIXE_INDICATIF } from './controles.mjs';

const ici = DONNEES;
const sansDonnees = !existsSync(join(ici, 'donnees.json')) || !existsSync(join(ici, 'export'));
const lire = () => {
  const d = JSON.parse(readFileSync(join(ici, 'donnees.json'), 'utf8'));
  // « _tables.json » (manifeste, 15/11) n'est pas une table : exclu
  const tables = Object.fromEntries(readdirSync(join(ici, 'export')).filter(f => f.endsWith('.json') && !f.startsWith('_'))
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
// Même cycle que l'export (clé remiseAZero) : sinon un cycle réglé ferait voir aux contrôles une autre semaine en cours
const { debutSemaine } = fabriquer(REMISE_A_ZERO);
const verifier = ({ d, tables }, opts = {}) => controler(d, tables, { maintenant: maintenantDe(d), groupes: GROUPES, debutSemaine, ...opts });

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
  const w = controler(x.d, x.tables, { maintenant: maintenantDe(x.d) + 30 * 36e5, groupes: GROUPES, debutSemaine });
  assert.ok(w.aVerifier.some(a => a.includes('sonar muet')));
}, x => (x.d.projections ?? []).some(p => p.type === 'hebdo'));

// ---- Reset non déclaré et semaine coupée (15/11) : données fabriquées, sans donnees.json ----
const FENETRE = '2026-10-25T10:00:00.000Z';
const releve = (heure, pct, fenetre = FENETRE) => ({ type: 'hebdo', releve: `2026-11-02T${heure}:00:00.000Z`, pct, debutFenetre: fenetre, debutSegment: fenetre });
const dFab = (projections, resetsDeclares = { semaines: {}, precis: [] }) => ({
  total: { cout: 0, appels: 0, entree: 0, ecritureCache: 0, lectureCache: 0, sortie: 0 }, projections, resetsDeclares,
});
const MAINT = Date.parse('2026-11-05T00:00:00Z');
const aSignal = v => v.aVerifier.some(a => a.includes('reset probable'));

tester('baisse confirmée non déclarée → À VÉRIFIER (une fois par fenêtre)', () => {
  const v = controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)]), {}, { maintenant: MAINT });
  assert.ok(v.aVerifier.some(a => a.includes('reset probable entre le 02/11 09:00 et le 02/11 10:00 UTC (semaine du 2026-10-25)')), JSON.stringify(v));
  assert.equal(v.aVerifier.filter(a => a.includes('reset probable')).length, 1);
});

tester('baisse isolée (26 → 12 → 26) : aucun signal', () => {
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 58)]), {}, { maintenant: MAINT })));
});

tester('remise à zéro du cycle (autre fenêtre) : aucun signal', () => {
  const autre = '2026-11-01T10:00:00.000Z';
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30, autre), releve('11', 28, autre)]), {}, { maintenant: MAINT })));
});

tester('reset précis déclaré dans ]a, b] : aucun signal', () => {
  const decl = { semaines: {}, precis: [{ quand: '2026-11-02T09:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {}, { maintenant: MAINT })));
});

tester('reset précis déclaré dans ]b, c] (confirmation expliquée par le reset) : aucun signal', () => {
  const decl = { semaines: {}, precis: [{ quand: '2026-11-02T10:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {}, { maintenant: MAINT })));
});

tester('baisse qui suit un reset déclaré : aucun signal (maximum remis à zéro)', () => {
  // Avant le reset (09:30) : 60 %. Après : 10, 12, 13 %. Sans limite au segment, la baisse de 11:00 serait signalée à tort.
  const decl = { semaines: {}, precis: [{ quand: '2026-11-02T09:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  const v = controler(dFab([releve('08', 40), releve('09', 60), releve('10', 10), releve('11', 12), releve('12', 13)], decl), {}, { maintenant: MAINT });
  assert.ok(!aSignal(v), JSON.stringify(v));
});
tester('semaine déclarée à l’ancienne forme : aucun signal', () => {
  const decl = { semaines: { '2026-10-25': 'nuit du 1er' }, precis: [] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {}, { maintenant: MAINT })));
});

tester('donnees.json sans resetsDeclares : pas d’exception', () => {
  const d = dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)]); delete d.resetsDeclares;
  assert.doesNotThrow(() => controler(d, {}, { maintenant: MAINT }));
});

// Semaine coupée : la règle « consommé > plafond » compare au coût du segment retenu, pas à la semaine entière
const coupee = cout => {
  const d = dFab([]);
  d.segmentsHebdo = [
    { semaine: '2026-11-01', debut: '2026-11-01T10:00:00.000Z', fin: '2026-11-03T21:00:00.000Z', cout: 70, sortie: 0 },
    { semaine: '2026-11-01', debut: '2026-11-03T21:00:00.000Z', fin: '2026-11-08T10:00:00.000Z', cout, sortie: 0 },
  ];
  const tables = {
    semaines: [{ debut: '2026-11-01', cout: 100, appels: 1, jetons: 0 }],
    plafondsHebdo: [{ semaine: '2026-11-01', statut: 'projeté (50 %) ; coupée par reset hebdo le 03/11 21:00 UTC (segment retenu : depuis le 03/11 21:00)',
      plafond: 40, consomme: 100, horsEstime: null, pctFin: 50, sortie: null, consommeSortie: 0 }],
  };
  return controler(d, tables, { maintenant: MAINT });
};
tester('semaine coupée : consommé du segment retenu (30 $ ≤ plafond 40 $) → pas d’anomalie', () => {
  assert.ok(!coupee(30).anomalies.some(a => a.includes('> plafond')), JSON.stringify(coupee(30)));
});
tester('suffixe de coupure : aller-retour exporter → contrôle (le segment retenu est bien retrouvé)', () => {
  // Dates distinctes (paramètres non inversables) ; segment leurre placé avant le bon : seul le segment nommé par le suffixe compte
  const s = suffixeCoupee('2026-11-03T21:00:00.000Z', '2026-11-05T08:00:00.000Z');
  assert.equal(s, ' ; coupée par reset hebdo le 03/11 21:00 UTC (segment retenu : depuis le 05/11 08:00)');
  const d = dFab([]);
  d.segmentsHebdo = [
    { semaine: '2026-11-01', debut: '2026-11-03T21:00:00.000Z', fin: '2026-11-05T08:00:00.000Z', cout: 10, sortie: 0 },
    { semaine: '2026-11-01', debut: '2026-11-05T08:00:00.000Z', fin: '2026-11-08T10:00:00.000Z', cout: 50, sortie: 0 },
  ];
  const tables = { semaines: [{ debut: '2026-11-01', cout: 100, appels: 1, jetons: 0 }],
    plafondsHebdo: [{ semaine: '2026-11-01', statut: 'projeté (50 %)' + s, plafond: 40, consomme: 100, horsEstime: null, pctFin: 50, sortie: null, consommeSortie: 0 }] };
  const v = controler(d, tables, { maintenant: MAINT });
  assert.ok(!v.anomalies.some(a => a.includes('segment retenu absent')), JSON.stringify(v));
  assert.ok(v.anomalies.some(a => a.includes('consommé 50 $ > plafond 40 $')), JSON.stringify(v));
});
tester('semaine coupée : consommé du segment retenu (50 $ > plafond 40 $) → anomalie', () => {
  assert.ok(coupee(50).anomalies.some(a => a.includes('consommé 50 $ > plafond 40 $')), JSON.stringify(coupee(50)));
});

// ---- Forfaits déclarés (15/11, plan #2) : données fabriquées. Pro jusqu'à la semaine du 18/10, Max 5x depuis celle du 25/10 (changement) ----
const FORF = [
  { date: '2026-10-18', semaine: '2026-10-18', forfait: 'Pro', changement: false },
  { date: '2026-10-25', semaine: '2026-10-25', forfait: 'Max 5x', changement: true },
];
const pente = (debut, plafond, silence = false) => ({ debut, fin: debut.slice(0, 11) + '20:00', ecart: 10, heures: 10, plafond, silence });
const ligneHebdo = (semaine, statut, plafond = null, consomme = 0) =>
  ({ semaine, statut, plafond, consomme, horsEstime: null, pctFin: null, sortie: null, consommeSortie: 0 });
const semainesVides = (...debuts) => debuts.map(debut => ({ debut, cout: 0, appels: 0, jetons: 0 }));

tester('forfaitDe : « » avant la première entrée, libellé de l’entrée sur sa semaine et après', () => {
  assert.equal(forfaitDe(FORF, '2026-10-11'), '');
  assert.equal(forfaitDe(FORF, '2026-10-18'), 'Pro');
  assert.equal(forfaitDe(FORF, '2026-10-25'), 'Max 5x');
  assert.equal(forfaitDe(FORF, '2026-11-08'), 'Max 5x');
  assert.equal(forfaitDe([], '2026-11-01'), '');
});

tester('bande par forfait : une pente d’un autre forfait ne déclenche pas À VÉRIFIER', () => {
  // Médiane unique (100, 100, 300) = 100 $ → 300 $ hors bande ; par forfait, Max 5x n’a que cette pente (300 $) : rien à signaler
  const v = controler(dFab([]), { forfaits: FORF, semaines: [], plafondsHebdo: [],
    pentes: [pente('2026-10-20T10:00', 100), pente('2026-10-21T10:00', 100), pente('2026-11-02T10:00', 300)] }, { maintenant: MAINT });
  assert.ok(!v.aVerifier.some(a => a.includes('300 $')), JSON.stringify(v));
});

tester('bande par forfait : un écart reste signalé dans son propre forfait', () => {
  // Max 5x (semaine du 01/11) : 300, 310, 1000 $ → médiane 310 $, 1000 $ hors bande ; nommé « du forfait « Max 5x » »
  const v = controler(dFab([]), { forfaits: FORF, semaines: [], plafondsHebdo: [],
    pentes: [pente('2026-11-02T10:00', 300), pente('2026-11-03T10:00', 310), pente('2026-11-04T10:00', 1000)] }, { maintenant: MAINT });
  assert.ok(v.aVerifier.some(a => a.includes('1000 $') && a.includes('du forfait « Max 5x »')), JSON.stringify(v));
});

tester('semaine de changement : son plafond indicatif et ses pentes ne sont ni comparés ni dans la médiane', () => {
  const v = controler(dFab([]), { forfaits: FORF,
    semaines: [...semainesVides('2026-11-01'), { debut: '2026-10-25', cout: 10, appels: 1, jetons: 0 }],
    plafondsHebdo: [ligneHebdo('2026-10-25', `projeté (50 %) ; ${SUFFIXE_INDICATIF} (Pro → Max 5x)`, 5000, 10), ligneHebdo('2026-11-01', 'en cours')],
    pentes: [pente('2026-10-20T10:00', 100), pente('2026-10-21T10:00', 100), pente('2026-10-27T10:00', 5000)] }, { maintenant: MAINT });
  assert.ok(!v.aVerifier.some(a => a.includes('5000')), JSON.stringify(v));
  assert.ok(!v.anomalies.some(a => a.includes('suffixe') || a.includes('changement de forfait')), JSON.stringify(v));
});

tester('suffixe « plafond indicatif » : manquant sur une semaine de changement, ou présent ailleurs → anomalie', () => {
  const v = controler(dFab([]), { forfaits: FORF, semaines: semainesVides('2026-10-25', '2026-11-01'),
    plafondsHebdo: [ligneHebdo('2026-10-25', 'en cours'), ligneHebdo('2026-11-01', `en cours ; ${SUFFIXE_INDICATIF} (Pro → Max 5x)`)] }, { maintenant: MAINT });
  assert.ok(v.anomalies.some(a => a.includes('semaine 2026-10-25 : changement de forfait sans suffixe')), JSON.stringify(v));
  assert.ok(v.anomalies.some(a => a.includes('semaine 2026-11-01 : suffixe') && a.includes("hors d'une semaine de changement")), JSON.stringify(v));
});

tester('baisse du % dans une semaine de changement : pas de « reset probable » ; hors changement : signalée', () => {
  const pr = [releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)];
  assert.ok(!aSignal(controler(dFab(pr), { forfaits: FORF }, { maintenant: MAINT })));
  assert.ok(aSignal(controler(dFab(pr), { forfaits: [] }, { maintenant: MAINT })));
});

test('sans table « forfaits » (export ancien) : mêmes contrôles qu’avec une table vide', () => {
  const avec = verifier(lire());
  const x = lire(); delete x.tables.forfaits;
  assert.deepEqual(verifier(x), avec);
});
