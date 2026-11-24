// Tests de la lecture des journaux (lecture.mjs) sur des lignes écrites à la main, sans aucun contenu de message :
// jetons du conseiller (#14), détail 5 min / 1 h de l'écriture cache, archive corrigée par un journal encore présent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appelsDeLaLigne, lireJournaux, compactageDeLaLigne, formeDeLaLigne, lireArchive, ecrireArchive } from './lecture.mjs';
import { couts, INTEGRES } from './tarifs.mjs';

const LIEU = { projet: 'p1', session: 's1', sousAgent: false };
const ligne = (usage, extra = {}) => ({
  type: 'assistant', timestamp: '2026-11-15T10:00:00.000Z',
  message: { id: 'msg_1', model: 'claude-opus-5-5', usage }, ...extra,
});
const cache = (cinqMin, uneHeure) => ({ ephemeral_5m_input_tokens: cinqMin, ephemeral_1h_input_tokens: uneHeure });
// Réponse avec conseiller, forme des journaux Claude Code (nombres inventés) : deux étapes « message » du modèle
// principal autour d'une étape du conseiller ; le détail du haut ne couvre que la première étape « message »
const AVEC_CONSEILLER = {
  input_tokens: 4, output_tokens: 244, cache_creation_input_tokens: 12323, cache_read_input_tokens: 140030,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 11142 },
  iterations: [
    { type: 'message', input_tokens: 2, cache_creation: cache(0, 11142) },
    {
      type: 'advisor_message', model: 'claude-fable-5-2', input_tokens: 77025, output_tokens: 1500,
      cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, cache_creation: cache(2000, 0),
    },
    { type: 'message', input_tokens: 2, cache_creation: cache(1181, 0) },
  ],
};

test('sans iterations : une seule réponse, compteurs du haut, écriture sans détail comptée à 5 min', () => {
  const appels = appelsDeLaLigne(ligne({ input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30 }), LIEU);
  assert.deepEqual(appels, [['msg_1', {
    ts: '2026-11-15T10:00:00.000Z', projet: 'p1', session: 's1', sousAgent: false, agent: null, modele: 'Opus 5.5',
    entree: 10, ecritureCache: 30, ecriture1h: 0, ecriture5m: 30, lectureCache: 0, sortie: 20, reflexion: 0,
  }]]);
});

test('conseiller : une réponse de plus, à son modèle, clé <id>:advisor:<n> ; étapes « message » non recomptées', () => {
  const appels = appelsDeLaLigne(ligne(AVEC_CONSEILLER), LIEU);
  assert.deepEqual(appels.map(([id, a]) => [id, a.modele, a.entree, a.sortie]), [
    ['msg_1', 'Opus 5.5', 4, 244],
    ['msg_1:advisor:0', 'Fable 5.2', 77025, 1500],
  ]);
  const [, conseiller] = appels[1];
  assert.deepEqual([conseiller.ecritureCache, conseiller.ecriture5m, conseiller.ecriture1h], [2000, 2000, 0]);
});

test('conseiller Fable et Mythos, toutes versions : chacun à son modèle et à son tarif', () => {
  const etape = model => ({ type: 'advisor_message', model, input_tokens: 1000000, output_tokens: 0 });
  const usage = {
    input_tokens: 1, output_tokens: 1,
    iterations: ['claude-fable-5-2', 'claude-mythos-5-2', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5',
      'claude-mythos-5'].map(etape),
  };
  const appels = appelsDeLaLigne(ligne(usage), LIEU).slice(1);
  assert.deepEqual(appels.map(([id, a]) => [id, a.modele]), [
    ['msg_1:advisor:0', 'Fable 5.2'], ['msg_1:advisor:1', 'Mythos 5.2'], ['msg_1:advisor:2', 'Fable 5.1'],
    ['msg_1:advisor:3', 'Mythos 5.1'], ['msg_1:advisor:4', 'Fable 5'], ['msg_1:advisor:5', 'Mythos 5'],
  ]);
  // 1 million de jetons d'entrée = le prix d'entrée du modèle, même avec la seule liste intégrée (sans tarifs.json)
  const prix = appels.map(([, a]) => couts(a, { tarifs: INTEGRES, paliers: {} }).cout);
  assert.deepEqual(prix, [8, 8, 10, 10, 10, 10]);
});

test('étape du conseiller sans modèle, ou d\'un autre type : ignorée', () => {
  const usage = {
    input_tokens: 1, output_tokens: 1,
    iterations: [{ type: 'advisor_message', input_tokens: 5 }, { type: 'autre', model: 'claude-fable-5-2' }],
  };
  assert.equal(appelsDeLaLigne(ligne(usage), LIEU).length, 1);
});

test('écriture cache : détail 5 min / 1 h = somme des étapes « message » (l\'étape du conseiller à part)', () => {
  const [[, principal]] = appelsDeLaLigne(ligne(AVEC_CONSEILLER), LIEU);
  assert.equal(principal.ecritureCache, 12323);
  assert.equal(principal.ecriture1h, 11142);
  assert.equal(principal.ecriture5m, 1181);
});

test('écriture cache : une étape « message » sans détail → détail du haut', () => {
  const usage = {
    ...AVEC_CONSEILLER, cache_creation: cache(500, 9000),
    iterations: [AVEC_CONSEILLER.iterations[0], { type: 'message', cache_creation_input_tokens: 1181 }],
  };
  const [[, principal]] = appelsDeLaLigne(ligne(usage), LIEU);
  assert.equal(principal.ecriture1h, 9000);
  assert.equal(principal.ecriture5m, 500);
});

test('écriture cache : détail sans la clé 5 min → 0 à 5 min (pas le total), comme ccusage', () => {
  const usage = {
    input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 30,
    cache_creation: { ephemeral_1h_input_tokens: 30 },
  };
  const [[, principal]] = appelsDeLaLigne(ligne(usage), LIEU);
  assert.deepEqual([principal.ecriture5m, principal.ecriture1h], [0, 30]);
});

test('écriture cache : total absent → total du détail (jetons et coût d\'accord)', () => {
  const usage = {
    input_tokens: 1, output_tokens: 1,
    iterations: [{ type: 'message', cache_creation: cache(10, 0) }, { type: 'message', cache_creation: cache(0, 20) }],
  };
  const [[, principal]] = appelsDeLaLigne(ligne(usage), LIEU);
  assert.deepEqual([principal.ecritureCache, principal.ecriture5m, principal.ecriture1h], [30, 10, 20]);
});

// lireJournaux sur un vrai fichier temporaire : <racine>/<clé du dossier>/<session>.jsonl
async function lire(lignes, archive = new Map()) {
  const racine = mkdtempSync(join(tmpdir(), 'conso-lecture-'));
  try {
    const f = join(racine, 'C--projet', 'session-1.jsonl');
    mkdirSync(join(racine, 'C--projet'));
    writeFileSync(f, lignes.map(l => JSON.stringify(l)).join('\n') + '\n');
    const tables = { appels: archive, limites: new Map(), releves: new Map() };
    await lireJournaux([{ f, racine, cowork: false }], tables, cle => cle);
    return tables.appels;
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
}

test('archive : à sortie égale, la réponse relue dans un journal présent remplace l\'ancienne', async () => {
  const ancienne = {
    ...appelsDeLaLigne(ligne(AVEC_CONSEILLER), LIEU)[0][1], ecriture5m: 0, projet: 'ancien', session: 's-ancien',
  };
  // La réponse occupe deux lignes : la première, au compteur de sortie plus petit, ne doit pas bloquer la seconde
  const debut = ligne({ ...AVEC_CONSEILLER, output_tokens: 10 });
  const appels = await lire([debut, ligne(AVEC_CONSEILLER)], new Map([['msg_1', ancienne]]));
  assert.equal(appels.get('msg_1').ecriture5m, 1181);
  assert.equal(appels.get('msg_1').projet, 'ancien'); // rattachement d'origine gardé, compteurs relus
  // L'étape du conseiller, nouvelle, suit le rattachement de sa réponse principale
  const conseiller = appels.get('msg_1:advisor:0');
  assert.deepEqual([conseiller.modele, conseiller.projet, conseiller.session], ['Fable 5.2', 'ancien', 's-ancien']);
});

test('archive : le conseiller déjà archivé suit sa réponse principale quand elle change de rattachement', async () => {
  const [[, principal], [, conseiller]] = appelsDeLaLigne(ligne(AVEC_CONSEILLER), LIEU);
  const archive = new Map([
    ['msg_1', { ...principal, sortie: 10, projet: 'ancien', session: 's-ancien' }],
    ['msg_1:advisor:0', { ...conseiller, projet: 'ancien', session: 's-ancien' }],
  ]);
  const appels = await lire([ligne(AVEC_CONSEILLER)], archive);
  assert.deepEqual([appels.get('msg_1').projet, appels.get('msg_1').sortie], ['C--projet', 244]);
  const relu = appels.get('msg_1:advisor:0');
  assert.deepEqual([relu.projet, relu.session, relu.sortie], ['C--projet', 'session-1', 1500]);
});

test('archive : sortie plus grande dans l\'archive reste ; même passage : première ligne gardée', async () => {
  const grande = { ...appelsDeLaLigne(ligne(AVEC_CONSEILLER), LIEU)[0][1], sortie: 999, projet: 'ancien' };
  const appels = await lire([ligne(AVEC_CONSEILLER)], new Map([['msg_1', grande]]));
  assert.deepEqual([appels.get('msg_1').sortie, appels.get('msg_1').projet], [999, 'ancien']);
  assert.equal(appels.get('msg_1:advisor:0').projet, 'ancien');

  const doublon = ligne(AVEC_CONSEILLER, { isSidechain: true });
  const deux = await lire([ligne(AVEC_CONSEILLER), doublon]);
  assert.equal(deux.get('msg_1').sousAgent, false);
});

// Compactages (24/11) : seuls l'heure, le déclencheur et les tailles sont gardés ; ceux des sous-agents aussi, avec
// leur agent
const COMPACT = {
  type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-16T10:30:00.000Z', uuid: 'c-1',
  compactMetadata: { trigger: 'auto', preTokens: 300000, postTokens: 30000, durationMs: 9 },
};
// Forme de la requête (24/11) : l'ordre des champs est celui de Claude Code 2.1.3xx ; la forme elle-même n'est pas lue
const FORME = (ts, empreinte) => `{"type":"api-request-shape","sessionId":"session-1","shapeHash":"${empreinte}",`
  + `"timestamp":"${ts}","version":"2.1.321","shape":{"system":[{"type":"text","text":"consignes \\"usage\\""}]}}`;

test('compactage : ligne compact_boundary → heure, agent, déclencheur, tailles ; autre ligne → null', () => {
  assert.deepEqual(compactageDeLaLigne(COMPACT, 's1'),
    { ts: '2026-11-16T10:30:00.000Z', session: 's1', agent: null, declencheur: 'auto', avant: 300000, apres: 30000 });
  const bizarre = { ...COMPACT, compactMetadata: { trigger: 'x' } };
  assert.deepEqual(compactageDeLaLigne(bizarre, 's1', 'agent-1'),
    { ts: COMPACT.timestamp, session: 's1', agent: 'agent-1', declencheur: 'inconnu', avant: null, apres: null });
  assert.equal(compactageDeLaLigne({ ...COMPACT, subtype: 'autre' }, 's1'), null);
  assert.equal(compactageDeLaLigne({ ...COMPACT, timestamp: 'pas une date' }, 's1'), null);
});

test('forme : heure et empreinte lues dans le début de la ligne ; autre ligne ou champ illisible → null', () => {
  assert.deepEqual(formeDeLaLigne(FORME('2026-11-16T10:30:00.000Z', 'ee04036777dc7766'), 's1', 'agent-1'),
    { ts: '2026-11-16T10:30:00.000Z', session: 's1', agent: 'agent-1', empreinte: 'ee04036777dc7766' });
  assert.equal(formeDeLaLigne(FORME('pas une date', 'ee04036777dc7766'), 's1'), null);
  assert.equal(formeDeLaLigne(FORME('2026-11-16T10:30:00.000Z', 'pas-hexa'), 's1'), null);
  // Un message qui cite le mot ne commence pas par la forme exacte
  assert.equal(formeDeLaLigne('{"type":"user","text":"{\\"type\\":\\"api-request-shape\\"}"}', 's1'), null);
});

test('compactage et forme : lus dans la conversation principale et dans un sous-agent ; la réponse voisine est comptée', async () => {
  const racine = mkdtempSync(join(tmpdir(), 'conso-lecture-'));
  try {
    const principal = join(racine, 'C--projet', 'session-1.jsonl');
    const sous = join(racine, 'C--projet', 'session-1', 'subagents', 'agent-1.jsonl');
    mkdirSync(join(racine, 'C--projet', 'session-1', 'subagents'), { recursive: true });
    writeFileSync(principal, [JSON.stringify(COMPACT), FORME('2026-11-16T10:31:00.000Z', 'aaaa0000'),
      JSON.stringify(ligne(AVEC_CONSEILLER))].join('\n') + '\n');
    writeFileSync(sous, [JSON.stringify({ ...COMPACT, uuid: 'c-2' }), FORME('2026-11-16T10:32:00.000Z', 'bbbb1111')].join('\n') + '\n');
    const tables = { appels: new Map(), limites: new Map(), releves: new Map(), compactages: new Map(), formes: new Map() };
    const { lignes } = await lireJournaux([principal, sous].map(f => ({ f, racine, cowork: false })), tables, cle => cle);
    assert.deepEqual([...tables.compactages.keys()], ['c-1', 'c-2']);
    assert.deepEqual([...tables.compactages.values()].map(c => [c.session, c.agent]), [['session-1', null], ['session-1', 'agent-1']]);
    assert.deepEqual([...tables.formes.values()].map(f => [f.agent, f.empreinte]), [[null, 'aaaa0000'], ['agent-1', 'bbbb1111']]);
    assert.equal(lignes, 1); // la forme, qui cite « usage », n'est pas lue comme une ligne de compteurs
    assert.ok(tables.appels.has('msg_1'));
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('archive : une archive d\'avant le 24/11 (sans compactages) se lit ; compactages de mauvaise forme → erreur', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'conso-archive-'));
  try {
    const f = join(dossier, 'archive-appels.json');
    writeFileSync(f, JSON.stringify({ appels: {}, limites: {}, releves: {} }));
    assert.equal(lireArchive(f).compactages.size, 0);
    assert.equal(lireArchive(f).formes.size, 0);
    // Les formes survivent à une écriture puis une relecture de l'archive
    const formes = new Map([['s/ /t', { ts: '2026-11-16T10:00:00Z', session: 's', agent: null, empreinte: 'aaaa' }]]);
    ecrireArchive(f, { appels: new Map(), limites: new Map(), releves: new Map(), formes });
    assert.deepEqual([...lireArchive(f).formes.values()], [...formes.values()]);
    writeFileSync(f, JSON.stringify({ appels: {}, limites: {}, releves: {}, compactages: [] }));
    assert.throws(() => lireArchive(f), /forme inattendue/);
    writeFileSync(f, JSON.stringify({ appels: {}, limites: {}, releves: {}, formes: [] }));
    assert.throws(() => lireArchive(f), /forme inattendue/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
