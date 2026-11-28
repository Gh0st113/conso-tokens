// Tests des validateurs de réglages (15/11, plan #5) : node --test reglages.test.mjs
// Purs : aucune donnée ni config.local.json nécessaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCycle, lireResets, lireForfaits, lireCache, lireObjectifContexte, CYCLE_DEFAUT, nomsAnciens,
  choisirDossierDonnees } from './reglages.mjs';
import * as semaine from './semaine.mjs';
import { fabriquer } from './semaine.mjs';

test('lireObjectifContexte (#16) : défaut, pourcentages entiers acceptés, refus clairs', () => {
  assert.deepEqual(lireObjectifContexte(undefined), { partMax: 0.5 });
  assert.deepEqual(lireObjectifContexte({}), { partMax: 0.5 });
  assert.deepEqual(lireObjectifContexte({ maxShare: 0.4 }), { partMax: 0.4 });
  assert.deepEqual(lireObjectifContexte({ maxShare: 0.29 }), { partMax: 0.29 }, '0.29 × 100 n\'est pas un entier exact');
  assert.deepEqual(lireObjectifContexte({ maxShare: 1 }), { partMax: 1 });
  assert.deepEqual(lireObjectifContexte({ maxShare: 0.01 }), { partMax: 0.01 });
  for (const v of [0, -0.1, 1.5, 0.375, 1e-11, '0.4', null, NaN])
    assert.throws(() => lireObjectifContexte({ maxShare: v }), /maxShare/, JSON.stringify(v));
  assert.throws(() => lireObjectifContexte(0.4), /doit être un objet/);
  assert.throws(() => lireObjectifContexte([]), /doit être un objet/);
  assert.throws(() => lireObjectifContexte({ maxShare: 0.4, threshold: 100000 }), /champ inconnu « threshold »/);
});

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
  assert.throws(() => lireResets([{ quand: '2026-11-03T21:00:00Z', type: 'hebdo' }], defaut), /« quand »/,
    'secondes refusées');
  assert.throws(() => lireResets([{ quand: '2026-02-31T21:00Z', type: 'hebdo' }], defaut), /« quand »/,
    'date impossible');
});

test('lireResets : ancienne forme → même table semaines, precis vide', () => {
  assert.deepEqual(lireResets({ '2026-01-04': 'nuit du 3 au 4' }, defaut),
    { semaines: { '2026-01-04': 'nuit du 3 au 4' }, precis: [] });
});

test('lireResets : ancienne forme, clés et valeurs vérifiées (#53)', () => {
  assert.throws(() => lireResets({ '2026-1-4': 'x' }, defaut), /jour réel AAAA-MM-JJ/, 'forme de clé');
  assert.throws(() => lireResets({ '2026-02-31': 'x' }, defaut), /jour réel AAAA-MM-JJ/, 'jour impossible');
  assert.throws(() => lireResets({ '2026-01-05': 'x' }, defaut), /pas un début de semaine.*2026-01-04/, 'lundi, cycle dimanche');
  assert.throws(() => lireResets({ '2026-01-04': 3 }, defaut), /valeur doit être un texte/, 'valeur non texte');
  // Le début de semaine suit le cycle : lundi accepté avec un cycle du lundi, dimanche refusé
  const lundi = cycle({ jour: 'lundi', heureUTC: '08:00' });
  assert.deepEqual(lireResets({ '2026-01-05': 'x' }, lundi).semaines, { '2026-01-05': 'x' });
  assert.throws(() => lireResets({ '2026-01-04': 'x' }, lundi), /pas un début de semaine/);
  // Heure de remise à zéro tardive : le jour reste accepté
  assert.deepEqual(lireResets({ '2026-01-04': 'x' }, cycle({ jour: 'dimanche', heureUTC: '23:59' })).semaines,
    { '2026-01-04': 'x' });
  assert.deepEqual(lireResets({}, defaut), { semaines: {}, precis: [] });
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
  assert.equal(semaineDe('2026-11-01', lireCycle(undefined)), '2026-11-01'); // dimanche 10:00 (défaut)
  assert.equal(semaineDe('2026-10-31', lireCycle(undefined)), '2026-10-25'); // samedi : semaine d'avant
  // après midi UTC
  assert.equal(semaineDe('2026-11-01', lireCycle({ jour: 'dimanche', heureUTC: '18:00' })), '2026-11-01');
  assert.equal(semaineDe('2026-11-02', lireCycle({ jour: 'lundi', heureUTC: '08:00' })), '2026-11-02'); // lundi 08:00
  // dimanche : semaine d'avant
  assert.equal(semaineDe('2026-11-01', lireCycle({ jour: 'lundi', heureUTC: '08:00' })), '2026-10-26');
  assert.equal(semaineDe('2026-11-03', lireCycle(undefined)), '2026-11-01'); // mardi : semaine qui le contient
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
  const r = forfaits({ '2026-11-01': 'Team Premium', '2026-11-08': 'Équipe', '2026-11-15': 'Max 5x',
    '2026-11-22': 'Ultra+' });
  assert.deepEqual(r.map(e => e.forfait), ['Team Premium', 'Équipe', 'Max 5x', 'Ultra+']);
});

test('lireForfaits : entrées invalides → erreur (échec fermé)', () => {
  const invalides = [
    [[], 'objet'], [null, 'objet'], ['Pro', 'objet'], [3, 'objet'],
    [{ '2026-13-01': 'Pro' }, 'illisible'], [{ '2026-1-5': 'Pro' }, 'illisible'],
    [{ '2026-02-30': 'Pro' }, 'illisible'],
    [{ '2026-11-01': '' }, 'vide'], [{ '2026-11-01': '   ' }, 'vide'],
    [{ '2026-11-01': 'a'.repeat(41) }, '40 caractères'],
    [{ '2026-11-01': 3 }, 'texte'],
    [{ '2026-11-01': 'Pro (50 %)' }, 'alphabet'],
    [{ '2026-11-01': 'Pro', '2026-11-03': 'Max 5x' }, 'même semaine'],
  ];
  for (const [v, motif] of invalides) assert.throws(() => forfaits(v), new RegExp(motif), JSON.stringify(v));
  assert.doesNotThrow(() => forfaits({ '2026-11-01': 'a'.repeat(40) }));
});

test('lireForfaits : longueur comptée en caractères (et non en unités UTF-16) : 21 lettres astrales acceptées', () => {
  assert.equal(forfaits({ '2026-11-01': '𐐀'.repeat(21) })[0].forfait, '𐐀'.repeat(21));
  assert.throws(() => forfaits({ '2026-11-01': '𐐀'.repeat(41) }), /40 caractères/);
});

test('choisirBase : mode clone par chacun des indices, mode paquet sans indice, CONSO_TOKENS_DIR prioritaire', async () => {
  const { choisirBase } = await import('./reglages.mjs');
  const base = (presents, env) => choisirBase({ ici: '/code', maison: '/moi', env, existe: p => presents.includes(p) });
  for (const n of ['.git', 'config.local.json', 'donnees'])
    assert.deepEqual(base([`/code/${n}`]), { mode: 'clone', base: '/code', force: false });
  assert.deepEqual(base([]), { mode: 'paquet', base: '/moi/.conso-tokens', force: false });
  assert.deepEqual(base([], { CONSO_TOKENS_DIR: '/ailleurs' }), { mode: 'paquet', base: '/ailleurs', force: true });
  assert.deepEqual(base(['/code/.git'], { CONSO_TOKENS_DIR: '/ailleurs' }),
    { mode: 'clone', base: '/ailleurs', force: true });
  assert.deepEqual(base([], { CONSO_TOKENS_DIR: '   ' }), { mode: 'paquet', base: '/moi/.conso-tokens', force: false });
});

test('INDICES_CLONE : data/ n’en fait pas partie (un data/ égaré dans le paquet ne le fait pas passer en mode clone)',
  async () => {
    const { INDICES_CLONE, choisirBase } = await import('./reglages.mjs');
    assert.ok(!INDICES_CLONE.includes('data'));
    assert.ok(INDICES_CLONE.includes('donnees'));
    assert.equal(choisirBase({ ici: '/paquet', maison: '/moi', env: {}, existe: p => p === '/paquet/data' }).mode,
      'paquet');
  });

test('choisirBase : CONSO_TOKENS_DIR en ~/ développé, chemin relatif refusé (il dépendrait du dossier courant)',
  async () => {
    const { choisirBase } = await import('./reglages.mjs');
    const base = env => choisirBase({ ici: '/code', maison: '/moi', env, existe: () => false }).base;
    assert.equal(base({ CONSO_TOKENS_DIR: '~/alt' }), '/moi/alt');
    assert.equal(base({ CONSO_TOKENS_DIR: '~' }), '/moi');
    assert.equal(base({ CONSO_TOKENS_DIR: 'C:/alt' }), 'C:/alt');
    for (const v of ['data', './data', '../data', 'C:alt', '~autre']) assert.throws(() => base({ CONSO_TOKENS_DIR: v }),
      /chemin absolu/);
  });

// ---- Noms anglais (lot 1, 17/11) : chaque réglage s'écrit sous son nom anglais ou son ancien nom,
// jamais les deux ----
const ANCIENNE = {
  dossierDonnees: '~/conso-tokens-donnees', renommerProjets: [['projet-a-masquer', 'masqué']],
  remiseAZero: { jour: 'monday', heureUTC: '08:00' },
  resets: [{ quand: '2026-01-06T19:30Z', type: 'hebdo', note: 'essai' }], forfaits: { '2026-01-04': 'Pro' },
  trous: [['2026-01-10', '2026-01-12', 'perdus']],
  motifProjet: '^Documents-(.*)$',
};
const NOUVELLE = {
  dataDir: '~/conso-tokens-donnees', renameProjects: [['projet-a-masquer', 'masqué']],
  weeklyReset: { day: 'monday', hourUTC: '08:00' },
  resets: [{ when: '2026-01-06T19:30Z', type: 'weekly', note: 'essai' }], plans: { '2026-01-04': 'Pro' },
  gaps: [['2026-01-10', '2026-01-12', 'perdus']],
  projectPattern: '^Documents-(.*)$',
};
test('nomsAnciens : une config entièrement nouvelle devient exactement l’ancienne (mêmes valeurs lues ensuite)', () => {
  assert.deepEqual(nomsAnciens(NOUVELLE), ANCIENNE);
  assert.deepEqual(nomsAnciens(ANCIENNE), ANCIENNE);   // l'ancienne ne change pas
  assert.deepEqual(nomsAnciens({}), {});
});

test('nomsAnciens : mélange entre clés différentes permis (day + heureUTC, plans + when)', () => {
  const r = nomsAnciens({ weeklyReset: { day: 'monday', heureUTC: '08:00' },
    resets: [{ when: '2026-01-06T19:30Z', type: 'hebdo' }] });
  assert.deepEqual(r.remiseAZero, { jour: 'monday', heureUTC: '08:00' });
  assert.deepEqual(r.resets, [{ quand: '2026-01-06T19:30Z', type: 'hebdo' }]);
});

test('nomsAnciens : type « weekly » devient « hebdo » (et « hebdo » reste accepté)', () => {
  const r = nomsAnciens({ resets: [{ when: '2026-11-03T21:00Z', type: 'weekly' },
    { quand: '2026-11-10T21:00Z', type: 'hebdo' }] });
  assert.deepEqual(r.resets.map(e => e.type), ['hebdo', 'hebdo']);
  assert.equal(lireResets(r.resets, defaut).precis.length, 2);
  assert.equal(lireResets(nomsAnciens(NOUVELLE).resets, defaut).precis[0].note, 'essai');
});

test('nomsAnciens : même réglage sous les deux noms → arrêt (même valeur ou non)', () => {
  const doublons = [
    { dataDir: 'a', dossierDonnees: 'a' }, { weeklyReset: {}, remiseAZero: {} },
    { projectPattern: 'x', motifProjet: 'x' },
    { renameProjects: [], renommerProjets: [] }, { plans: {}, forfaits: {} }, { gaps: [], trous: [] },
    { weeklyReset: { day: 'monday', jour: 'monday' } }, { weeklyReset: { hourUTC: '08:00', heureUTC: '08:00' } },
    { resets: [{ when: '2026-11-03T21:00Z', quand: '2026-11-03T21:00Z', type: 'hebdo' }] },
  ];
  for (const c of doublons) assert.throws(() => nomsAnciens(c), /deux noms/, JSON.stringify(c));
});

test('nomsAnciens : clé nouvelle seule pour la forme resets objet (date → quand) : inchangée', () => {
  assert.deepEqual(nomsAnciens({ resets: { '2026-01-04': 'nuit' } }), { resets: { '2026-01-04': 'nuit' } });
});

// ---- Dossier des données sans chemin explicite (lot 1, 17/11) ----
test('choisirDossierDonnees : rien → data ; donnees seul → donnees (installation antérieure) ; data seul → data',
  () => {
    const dossier = presents =>
      choisirDossierDonnees({ base: '/base', existe: p => presents.includes(p), joindre: (a, b) => `${a}/${b}` });
    assert.equal(dossier([]), 'data');
    assert.equal(dossier(['/base/donnees']), 'donnees');
    assert.equal(dossier(['/base/data']), 'data');
  });

test('choisirDossierDonnees : data ET donnees présents → arrêt, message qui nomme les deux', () => {
  assert.throws(() => choisirDossierDonnees({ base: '/base', existe: () => true, joindre: (a, b) => `${a}/${b}` }),
    /« data » et « donnees »/);
});

test('lireCache : défauts, réglage partiel, refus clairs', () => {
  assert.deepEqual(lireCache(undefined),
    { principal: { ttl: 'auto', ecritureMin: 20000 }, sousAgent: { ttl: 'auto', ecritureMin: 10000 } });
  assert.deepEqual(lireCache({ subagents: { ttl: '1h' } }),
    { principal: { ttl: 'auto', ecritureMin: 20000 }, sousAgent: { ttl: '1h', ecritureMin: 10000 } });
  assert.deepEqual(lireCache({ main: { minWrite: 5000 } }).principal, { ttl: 'auto', ecritureMin: 5000 });
  assert.throws(() => lireCache([]), /doit être un objet/);
  assert.throws(() => lireCache({ principal: {} }), /clé inconnue « principal »/);
  assert.throws(() => lireCache({ main: { ttl: '30m' } }), /main\.ttl/);
  assert.throws(() => lireCache({ main: { minWrite: 0 } }), /main\.minWrite/);
  assert.throws(() => lireCache({ subagents: { duree: '5m' } }), /champ inconnu « duree »/);
});
