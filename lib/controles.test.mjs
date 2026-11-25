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
import { controler, rapport, forfaitDe } from './controles.mjs';

const ici = DONNEES;
const sansDonnees = !existsSync(join(ici, 'donnees.json')) || !existsSync(join(ici, 'export'));
const lire = () => {
  const d = JSON.parse(readFileSync(join(ici, 'donnees.json'), 'utf8'));
  // « _tables.json » (manifeste, 15/11) n'est pas une table : exclu
  const tables = Object.fromEntries(readdirSync(join(ici, 'export'))
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => [f.slice(0, -5), JSON.parse(readFileSync(join(ici, 'export', f), 'utf8'))]));
  return { d, tables };
};
const base = sansDonnees ? null : lire();
// besoin(données) : faux = pas assez d'historique pour ce test → sauté
const test = (nom, fn, besoin = () => true) => tester(nom,
  { skip: sansDonnees ? 'pas de données : lancer agreger.mjs puis exporter.mjs'
    : !besoin(base) && 'pas assez de données pour ce test' }, fn);
const n = (table, min = 1) => x => (x.tables[table]?.length ?? 0) >= min;
// Groupes de modèles = colonnes de « semaines » qui ont une jumelle « j… » (jetons), comme les écrit lib/tables.mjs
const GROUPES = (() => {
  const cles = new Set((base?.tables.semaines ?? []).flatMap(Object.keys));
  return [...cles].filter(k => !['debut', 'cout', 'appels', 'jetons', 'manque'].includes(k) && cles.has('j' + k));
})();
// « Maintenant » = heure de génération de donnees.json (l'export suit dans la même commande) :
// même semaine que l'export
const maintenantDe = d => Date.parse(d.genereLe);
// Même cycle que l'export (clé remiseAZero) : sinon un cycle réglé ferait voir aux contrôles une autre semaine en cours
const { debutSemaine } = fabriquer(REMISE_A_ZERO);
const verifier = ({ d, tables }, opts = {}) =>
  controler(d, tables, { maintenant: maintenantDe(d), groupes: GROUPES, debutSemaine, ...opts });

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

test('état absent ou inconnu : anomalie, pas plantage', () => {
  const x = lire(); delete x.tables.plafondsHebdo[0].etat; x.tables.plafondsHebdo[1].etat = 'atteint (relevé à 100 %)';
  const a = verifier(x).anomalies;
  assert.ok(a.some(a => a.includes(`semaine ${x.tables.plafondsHebdo[0].semaine} : état « undefined » inconnu`)),
    a.join('\n'));
  assert.ok(a.some(a => a.includes('état « atteint (relevé à 100 %) » inconnu')), a.join('\n'));
}, n('plafondsHebdo', 2));

test('état reset sans note, ou note hors état reset : anomalie', () => {
  // r1 : une autre semaine qui n'est pas déjà une semaine de reset (les données peuvent en avoir une)
  const x = lire();
  const r0 = x.tables.plafondsHebdo[0], r1 = x.tables.plafondsHebdo.slice(1).find(r => r.etat !== 'reset');
  r0.etat = 'reset'; r0.resetNote = null; r1.resetNote = 'oubli';
  const a = verifier(x).anomalies;
  assert.ok(a.some(a => a.includes(`semaine ${r0.semaine} : état reset et resetNote = null`)), a.join('\n'));
  assert.ok(a.some(a => a.includes(`semaine ${r1.semaine} : état ${r1.etat} et resetNote = oubli`)), a.join('\n'));
}, x => (x.tables.plafondsHebdo ?? []).slice(1).some(r => r.etat !== 'reset'));

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
  // un groupe qui ne retombe plus sur la semaine
  const x = lire(); const s = x.tables.semaines.at(-1); s[GROUPES[0]] = (s[GROUPES[0]] ?? 0) + 1;
  assert.ok(verifier(x).anomalies.some(a => a.includes(`semaine ${s.debut} : groupes`)));
}, x => n('semaines')(x) && GROUPES.length > 0);

test('modèle sans tarif', () => {
  const x = lire(); x.d.parModele['Truc 9'] = { cout: 0 };
  assert.ok(verifier(x).anomalies.some(a => a.includes('« Truc 9 » sans tarif')));
});

// Depuis le lot 2a de #17, plus de contrôle « le statut dit N pts / N % » : la phrase est fabriquée par la page depuis
// ces mêmes colonnes (une seule source). Restent les contrôles entre colonnes :
test('plus de points hors PC que de % atteints', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  r.etat = 'enCours'; r.pct = 20; r.pctFin = 20; r.horsEstime = 25;
  assert.ok(verifier(x).anomalies.some(a => a.includes(`semaine ${r.semaine} : 25 pts hors PC > 20 % atteints`)));
}, n('plafondsHebdo'));

test('pct différent de pctFin', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  r.etat = 'enCours'; r.pct = 81; r.horsEstime = 10; r.pctFin = 86; // ligne construite, pas de sortie anticipée
  assert.ok(verifier(x).anomalies.some(a => a.includes('pct = 81, pctFin = 86')));
}, n('plafondsHebdo'));

test('pct en texte (relevé sonar non typé) égal à pctFin : pas d’anomalie', () => {
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  r.etat = 'enCours'; r.pct = '50'; r.horsEstime = 10; r.pctFin = 50;
  assert.ok(!verifier(x).anomalies.some(a => a.includes('pctFin')), verifier(x).anomalies.join('\n'));
}, n('plafondsHebdo'));

test('plafond affiché inférieur au consommé', () => {
  // Semaine non coupée (sinon le contrôle compare au coût du segment retenu, pas à r.consomme)
  const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
  r.etat = 'projete'; r.pct = 50; r.plafond = r.consomme - 10; r.horsEstime = null; r.pctFin = null;
  r.coupeePremier = r.coupeeDepuis = null;
  assert.ok(verifier(x).anomalies.some(a => a.includes('> plafond')));
}, n('plafondsHebdo'));

test('plafond inférieur au consommé : permis quand la limite est atteinte ou le relevé à 100 %', () => {
  for (const etat of ['atteint', 'plein']) {
    const x = lire(); const r = x.tables.plafondsHebdo.at(-1);
    r.etat = etat; r.pct = null; r.plafond = r.consomme - 10; r.horsEstime = null; r.pctFin = null;
    assert.ok(!verifier(x).anomalies.some(a => a.includes('> plafond')), etat);
  }
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
  r.plafond = haut; r.etat = 'projete'; r.pct = 90; r.horsEstime = null; r.pctFin = null;
  const v = verifier(x);
  assert.ok(v.aVerifier.some(a => a.includes(`plafond de la semaine ${r.semaine} = ${haut} $`)));
  assert.ok(!v.anomalies.some(a => a.includes(String(haut))));
}, x => n('plafondsHebdo')(x) && x.tables.pentes.filter(p => !p.silence).length >= 3);

test('vieille pente hors bande : ignorée (historique connu)', () => {
  const x = lire();
  const max = Math.max(...x.tables.pentes.filter(p => !p.silence).map(p => p.plafond));
  // la médiane reste ≤ max : 3 × max est hors bande
  const vieille = Math.round(max * 30) + 1, recente = Math.round(max * 3) + 1;
  x.tables.pentes.unshift(
    { debut: '2000-01-01T10:00', fin: '2000-01-02T10:00', ecart: 10, heures: 24, plafond: vieille, silence: false });
  x.tables.pentes.push({ debut: x.tables.plafondsHebdo.at(-1).semaine + 'T12:00',
    fin: x.tables.plafondsHebdo.at(-1).semaine + 'T20:00', ecart: 10, heures: 8, plafond: recente, silence: false });
  const v = verifier(x).aVerifier;
  assert.ok(!v.some(a => a.includes(`${vieille} $`)), 'l’ancienne pente doit être ignorée');
  assert.ok(v.some(a => a.includes(`${recente} $`)), 'la pente récente doit être signalée');
}, x => n('plafondsHebdo')(x) && x.tables.pentes.filter(p => !p.silence).length >= 3);

test('sonar muet depuis plus de 24 h alors que le PC consomme', () => {
  const x = lire();
  // 30 h après le dernier relevé, avec une consommation ce jour-là
  x.tables.jours.push({
    jour: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenantDe(x.d) + 30 * 36e5),
    cout: 5, appels: 1, jetons: 1, manque: '' });
  const w = controler(x.d, x.tables, { maintenant: maintenantDe(x.d) + 30 * 36e5, groupes: GROUPES, debutSemaine });
  assert.ok(w.aVerifier.some(a => a.includes('sonar muet')));
}, x => (x.d.projections ?? []).some(p => p.type === 'hebdo'));

// ---- Reset non déclaré et semaine coupée (15/11) : données fabriquées, sans donnees.json ----
const FENETRE = '2026-10-25T10:00:00.000Z';
const releve = (heure, pct, fenetre = FENETRE) =>
  ({ type: 'hebdo', releve: `2026-11-02T${heure}:00:00.000Z`, pct, debutFenetre: fenetre, debutSegment: fenetre });
const dFab = (projections, resetsDeclares = { semaines: {}, precis: [] }) => ({
  total: { cout: 0, appels: 0, entree: 0, ecritureCache: 0, lectureCache: 0, sortie: 0 }, projections, resetsDeclares,
});
const MAINT = Date.parse('2026-11-05T00:00:00Z');
const aSignal = v => v.aVerifier.some(a => a.includes('reset probable'));

tester('baisse confirmée non déclarée → À VÉRIFIER (une fois par fenêtre)', () => {
  const v = controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)]), {},
    { maintenant: MAINT });
  assert.ok(v.aVerifier.some(a =>
    a.includes('reset probable entre le 02/11 09:00 et le 02/11 10:00 UTC (semaine du 2026-10-25)')),
    JSON.stringify(v));
  assert.equal(v.aVerifier.filter(a => a.includes('reset probable')).length, 1);
});

tester('baisse isolée (26 → 12 → 26) : aucun signal', () => {
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 58)]), {},
    { maintenant: MAINT })));
});

tester('remise à zéro du cycle (autre fenêtre) : aucun signal', () => {
  const autre = '2026-11-01T10:00:00.000Z';
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30, autre),
    releve('11', 28, autre)]), {}, { maintenant: MAINT })));
});

tester('reset précis déclaré dans ]a, b] : aucun signal', () => {
  const decl = { semaines: {},
    precis: [{ quand: '2026-11-02T09:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {},
    { maintenant: MAINT })));
});

tester('reset précis déclaré dans ]b, c] (confirmation expliquée par le reset) : aucun signal', () => {
  const decl = { semaines: {},
    precis: [{ quand: '2026-11-02T10:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {},
    { maintenant: MAINT })));
});

tester('baisse qui suit un reset déclaré : aucun signal (maximum remis à zéro)', () => {
  // Avant le reset (09:30) : 60 %. Après : 10, 12, 13 %. Sans limite au segment, la baisse de 11:00 serait
  // signalée à tort.
  const decl = { semaines: {},
    precis: [{ quand: '2026-11-02T09:30:00.000Z', type: 'hebdo', note: '', semaine: '2026-10-25' }] };
  const v = controler(dFab([releve('08', 40), releve('09', 60), releve('10', 10), releve('11', 12), releve('12', 13)],
    decl), {}, { maintenant: MAINT });
  assert.ok(!aSignal(v), JSON.stringify(v));
});
tester('semaine déclarée à l’ancienne forme : aucun signal', () => {
  const decl = { semaines: { '2026-10-25': 'nuit du 1er' }, precis: [] };
  assert.ok(!aSignal(controler(dFab([releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)], decl), {},
    { maintenant: MAINT })));
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
    plafondsHebdo: [{ semaine: '2026-11-01', etat: 'projete', pct: 50, coupeePremier: '2026-11-03T21:00',
      coupeeDepuis: '2026-11-03T21:00',
      plafond: 40, consomme: 100, horsEstime: null, pctFin: 50, sortie: null, consommeSortie: 0 }],
  };
  return controler(d, tables, { maintenant: MAINT });
};
tester('semaine coupée : consommé du segment retenu (30 $ ≤ plafond 40 $) → pas d’anomalie', () => {
  assert.ok(!coupee(30).anomalies.some(a => a.includes('> plafond')), JSON.stringify(coupee(30)));
});
// Segment retenu nommé par coupeeDepuis (ISO à la minute, comme l'écrit exporter.mjs) : retrouvé dans segmentsHebdo,
// ou anomalie
const coupeeDepuis = depuis => {
  // Dates distinctes (premier ≠ depuis) ; segment leurre placé avant le bon :
  // seul le segment nommé par coupeeDepuis compte
  const d = dFab([]);
  d.segmentsHebdo = [
    { semaine: '2026-11-01', debut: '2026-11-03T21:00:00.000Z', fin: '2026-11-05T08:00:00.000Z', cout: 10, sortie: 0 },
    { semaine: '2026-11-01', debut: '2026-11-05T08:00:00.000Z', fin: '2026-11-08T10:00:00.000Z', cout: 50, sortie: 0 },
  ];
  const tables = { semaines: [{ debut: '2026-11-01', cout: 100, appels: 1, jetons: 0 }],
    plafondsHebdo: [{ semaine: '2026-11-01', etat: 'projete', pct: 50, coupeePremier: '2026-11-03T21:00',
      coupeeDepuis: depuis,
      plafond: 40, consomme: 100, horsEstime: null, pctFin: 50, sortie: null, consommeSortie: 0 }] };
  return controler(d, tables, { maintenant: MAINT });
};
tester('coupeeDepuis : le segment retenu est bien retrouvé (et pas le leurre)', () => {
  const v = coupeeDepuis('2026-11-05T08:00');
  assert.ok(!v.anomalies.some(a => a.includes('absent de segmentsHebdo')), JSON.stringify(v));
  assert.ok(v.anomalies.some(a => a.includes('consommé 50 $ > plafond 40 $')), JSON.stringify(v));
});
tester('coupeeDepuis qui ne nomme aucun segment → anomalie', () => {
  const v = coupeeDepuis('2026-11-05T09:00');
  assert.ok(v.anomalies.some(a => a.includes('segment retenu (2026-11-05T09:00) absent de segmentsHebdo')),
    JSON.stringify(v));
});
tester('semaine coupée : consommé du segment retenu (50 $ > plafond 40 $) → anomalie', () => {
  assert.ok(coupee(50).anomalies.some(a => a.includes('consommé 50 $ > plafond 40 $')), JSON.stringify(coupee(50)));
});

// ---- Forfaits déclarés (15/11, plan #2) : données fabriquées.
// Pro jusqu'à la semaine du 18/10, Max 5x depuis celle du 25/10 (changement) ----
const FORF = [
  { date: '2026-10-18', semaine: '2026-10-18', forfait: 'Pro', changement: false },
  { date: '2026-10-25', semaine: '2026-10-25', forfait: 'Max 5x', changement: true },
];
const pente = (debut, plafond, silence = false) =>
  ({ debut, fin: debut.slice(0, 11) + '20:00', ecart: 10, heures: 10, plafond, silence });
// indicatif = forfait d'avant → forfait de la semaine, comme exporter.mjs les écrit (indicatifDe / indicatifA), ou null
const ligneHebdo = (semaine, etat, plafond = null, consomme = 0, indicatif = null) =>
  ({ semaine, etat, pct: etat === 'projete' ? 50 : null, indicatifDe: indicatif?.[0] ?? null,
    indicatifA: indicatif?.[1] ?? null,
    plafond, consomme, horsEstime: null, pctFin: null, sortie: null, consommeSortie: 0 });
const semainesVides = (...debuts) => debuts.map(debut => ({ debut, cout: 0, appels: 0, jetons: 0 }));

tester('forfaitDe : « » avant la première entrée, libellé de l’entrée sur sa semaine et après', () => {
  assert.equal(forfaitDe(FORF, '2026-10-11'), '');
  assert.equal(forfaitDe(FORF, '2026-10-18'), 'Pro');
  assert.equal(forfaitDe(FORF, '2026-10-25'), 'Max 5x');
  assert.equal(forfaitDe(FORF, '2026-11-08'), 'Max 5x');
  assert.equal(forfaitDe([], '2026-11-01'), '');
});

tester('bande par forfait : une pente d’un autre forfait ne déclenche pas À VÉRIFIER', () => {
  // Médiane unique (100, 100, 300) = 100 $ → 300 $ hors bande ; par forfait, Max 5x n’a que cette pente (300 $) :
  // rien à signaler
  const v = controler(dFab([]), { forfaits: FORF, semaines: [], plafondsHebdo: [],
    pentes: [pente('2026-10-20T10:00', 100), pente('2026-10-21T10:00', 100), pente('2026-11-02T10:00', 300)] },
      { maintenant: MAINT });
  assert.ok(!v.aVerifier.some(a => a.includes('300 $')), JSON.stringify(v));
});

tester('bande par forfait : un écart reste signalé dans son propre forfait', () => {
  // Max 5x (semaine du 01/11) : 300, 310, 1000 $ → médiane 310 $, 1000 $ hors bande ; nommé « du forfait « Max 5x » »
  const v = controler(dFab([]), { forfaits: FORF, semaines: [], plafondsHebdo: [],
    pentes: [pente('2026-11-02T10:00', 300), pente('2026-11-03T10:00', 310), pente('2026-11-04T10:00', 1000)] },
      { maintenant: MAINT });
  assert.ok(v.aVerifier.some(a => a.includes('1000 $') && a.includes('du forfait « Max 5x »')), JSON.stringify(v));
});

tester('semaine de changement : son plafond indicatif et ses pentes ne sont ni comparés ni dans la médiane', () => {
  const v = controler(dFab([]), { forfaits: FORF,
    semaines: [...semainesVides('2026-11-01'), { debut: '2026-10-25', cout: 10, appels: 1, jetons: 0 }],
    plafondsHebdo: [ligneHebdo('2026-10-25', 'projete', 5000, 10, ['Pro', 'Max 5x']),
      ligneHebdo('2026-11-01', 'enCours')],
    pentes: [pente('2026-10-20T10:00', 100), pente('2026-10-21T10:00', 100), pente('2026-10-27T10:00', 5000)] },
      { maintenant: MAINT });
  assert.ok(!v.aVerifier.some(a => a.includes('5000')), JSON.stringify(v));
  assert.ok(!v.anomalies.some(a => a.includes('plafond indicatif') || a.includes('changement de forfait')),
    JSON.stringify(v));
});

tester('mention « plafond indicatif » : manquante sur une semaine de changement, ou présente ailleurs → anomalie', () => {
  const v = controler(dFab([]), { forfaits: FORF, semaines: semainesVides('2026-10-25', '2026-11-01'),
    plafondsHebdo: [ligneHebdo('2026-10-25', 'enCours'),
      ligneHebdo('2026-11-01', 'enCours', null, 0, ['Pro', 'Max 5x'])] }, { maintenant: MAINT });
  assert.ok(v.anomalies.some(a => a.includes('semaine 2026-10-25 : changement de forfait sans mention')),
    JSON.stringify(v));
  assert.ok(v.anomalies.some(a => a.includes('semaine 2026-11-01 : mention')
    && a.includes("hors d'une semaine de changement")), JSON.stringify(v));
});

tester('baisse du % dans une semaine de changement : pas de « reset probable » ; hors changement : signalée', () => {
  const pr = [releve('08', 40), releve('09', 60), releve('10', 30), releve('11', 28)];
  assert.ok(!aSignal(controler(dFab(pr), { forfaits: FORF }, { maintenant: MAINT })));
  assert.ok(aSignal(controler(dFab(pr), { forfaits: [] }, { maintenant: MAINT })));
});

test('sans table « forfaits » (export ancien) : mêmes contrôles qu’avec une table vide', () => {
  const vide = lire(); vide.tables.forfaits = [];
  const x = lire(); delete x.tables.forfaits;
  assert.deepEqual(verifier(x), verifier(vide));
});

tester('libellés « Pro » puis « pro » (même forfait, sans changement) : une seule médiane', () => {
  // Groupe Pro = 100, 100 $ ; la pente récente de « pro » (300 $) doit être comparée à ce groupe, donc signalée
  const v = controler(dFab([]),
    { forfaits: [{ date: '2026-10-18', semaine: '2026-10-18', forfait: 'Pro', changement: false },
    { date: '2026-10-25', semaine: '2026-10-25', forfait: 'pro', changement: false }], semaines: [], plafondsHebdo: [],
    pentes: [pente('2026-10-20T10:00', 100), pente('2026-10-21T10:00', 100), pente('2026-11-02T10:00', 300)] },
      { maintenant: MAINT });
  assert.ok(v.aVerifier.some(a => a.includes('300 $') && a.includes('du forfait « pro »')), JSON.stringify(v));
});
