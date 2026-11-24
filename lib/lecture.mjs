// Tout ce qu'agreger.mjs lit sur le disque : journaux, archive des compteurs, relevés du %.
// Des journaux, seuls les champs usage / model / timestamp / chemin sont lus, jamais le contenu des conversations ; des
// lignes de compactage (subtype compact_boundary), seulement l'heure, le déclencheur et les tailles avant / après.
// Seule exception : le bandeau « You've hit your … limit · resets … » des messages <synthetic>, pour l'heure de remise
// à zéro.
import { readdirSync, statSync, createReadStream, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';

// Cowork (sessions locales de Claude Desktop sous Windows) : même format de journal que Claude Code. Il n'y écrit plus
// depuis fin octobre 2026 (son usage passe en hors PC) : le dossier n'est lu que pour l'historique.
export function racinesCowork(maison) {
  const base = join(maison, 'AppData', 'Local', 'Claude-Data');
  const estDossier = p => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  try {
    return readdirSync(base).filter(n => n.startsWith('claude_'))
      .map(n => join(base, n, 'local-agent-mode-sessions')).filter(estDossier);
  } catch {
    return [];
  }
}

// Tous les .jsonl sous dir, sous-dossiers compris
export function lister(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...lister(p));
    else if (nom.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// claude-opus-4-6, claude-opus-4-1-20250805 → « Opus 4.6 », « Opus 4.1 » ; ancien ordre claude-3-7-sonnet-20250219 →
// « Sonnet 3.7 » ; suffixe « [1m] » ou « :… » ignoré. Autre forme : nom brut (il sera signalé « sans tarif »).
export function famille(model) {
  const id = model.replace(/\[.*\]$|:.*$/, '');
  const FAM = 'opus|sonnet|haiku|fable|mythos', VER = '\\d+(?:-\\d)?', DATE = '(?:-\\d{8})?$';
  let fam, ver, m;
  if ((m = id.match(new RegExp(`^claude-(${FAM})-(${VER})${DATE}`)))) [, fam, ver] = m;
  else if ((m = id.match(new RegExp(`^claude-(${VER})-(${FAM})${DATE}`)))) [, ver, fam] = m;
  else return model;
  return fam[0].toUpperCase() + fam.slice(1) + ' ' + ver.replaceAll('-', '.');
}

// Archive des passages précédents (Claude Code efface les vieux journaux, l'archive garde leurs compteurs).
// Illisible ou de forme inattendue → erreur : elle ne doit jamais être réécrite avec moins.
export function lireArchive(fichier) {
  let archive = { appels: {}, limites: {}, releves: {} };
  let nouvelle = false;
  try {
    archive = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`archive illisible, rien n'est écrit : ${fichier} (${e.message})`);
    nouvelle = true;
  }
  const objet = o => o && typeof o === 'object' && !Array.isArray(o);
  // compactages : ajoutés le 24/11, absents d'une archive plus ancienne (ils valent alors une liste vide)
  if (!objet(archive) || !['appels', 'limites', 'releves'].every(k => objet(archive[k]))
    || (archive.compactages !== undefined && !objet(archive.compactages))) {
    throw new Error(`archive de forme inattendue, rien n'est écrit : ${fichier}`);
  }
  return {
    appels: new Map(Object.entries(archive.appels)),
    limites: new Map(Object.entries(archive.limites)),
    releves: new Map(Object.entries(archive.releves)),
    compactages: new Map(Object.entries(archive.compactages ?? {})),
    nouvelle,
  };
}

// Écrite dans un fichier temporaire puis renommée : un arrêt en cours d'écriture ne laisse jamais une archive tronquée
export function ecrireArchive(fichier, { appels, limites, releves, compactages = new Map() }) {
  const tmp = `${fichier}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({
    majLe: new Date().toISOString(),
    appels: Object.fromEntries(appels), limites: Object.fromEntries(limites), releves: Object.fromEntries(releves),
    compactages: Object.fromEntries(compactages),
  }));
  renameSync(tmp, fichier);
}

// Détail 5 min / 1 h de l'écriture cache. Une réponse avec conseiller fait plusieurs étapes « message » : le détail du
// haut ne couvre que la première, alors que le total du haut les couvre toutes. Somme des étapes quand chacune a son
// détail, sinon le détail du haut (même règle que ccusage).
function detailEcriture(u) {
  const etapes = (Array.isArray(u.iterations) ? u.iterations : []).filter(e => e?.type === 'message');
  const objet = v => v && typeof v === 'object';
  if (!etapes.length || !etapes.every(e => objet(e.cache_creation))) return null;
  let cinqMin = 0, uneHeure = 0;
  for (const { cache_creation: c } of etapes) {
    cinqMin += c.ephemeral_5m_input_tokens || 0;
    uneHeure += c.ephemeral_1h_input_tokens || 0;
  }
  return { cinqMin, uneHeure };
}

// Compteurs d'un objet usage (celui du haut, ou une étape du conseiller). Sans aucun détail 5 min / 1 h, toute
// l'écriture cache est comptée à 5 min ; avec un détail, une clé absente vaut 0 (comme ccusage). Total absent : celui
// du détail, pour que jetons et coût restent d'accord.
function compteurs(v, detail) {
  const c = v.cache_creation && typeof v.cache_creation === 'object' ? v.cache_creation : null;
  const total = v.cache_creation_input_tokens;
  const ecriture1h = detail?.uneHeure ?? c?.ephemeral_1h_input_tokens ?? 0;
  const ecriture5m = detail?.cinqMin ?? (c ? c.ephemeral_5m_input_tokens ?? 0 : total || 0);
  return {
    entree: v.input_tokens || 0,
    ecritureCache: typeof total === 'number' ? total : ecriture1h + ecriture5m,
    ecriture1h,
    ecriture5m,
    lectureCache: v.cache_read_input_tokens || 0,
    sortie: v.output_tokens || 0,
    reflexion: v.output_tokens_details?.thinking_tokens || 0,
  };
}

// Réponses d'une ligne « assistant » : celle du modèle principal (compteurs du haut de usage), puis une par étape du
// conseiller (usage.iterations, type advisor_message), avec son propre modèle et la clé « <id>:advisor:<n> » de
// ccusage. Les étapes « message » sont déjà dans les compteurs du haut : jamais ajoutées une seconde fois.
export function appelsDeLaLigne(o, { projet, session, sousAgent, agent = null }) {
  const m = o.message, u = m.usage;
  const id = m.id || o.requestId || o.uuid;
  // agent : nom du fichier du sous-agent (24/11, fil de son cache) ; null pour la conversation principale
  const base = { ts: o.timestamp, projet, session, sousAgent: sousAgent || !!o.isSidechain, agent };
  const appels = [[id, { ...base, modele: famille(m.model), ...compteurs(u, detailEcriture(u)) }]];
  const conseiller = (Array.isArray(u.iterations) ? u.iterations : [])
    .filter(e => e?.type === 'advisor_message' && typeof e.model === 'string' && e.model);
  conseiller.forEach((e, n) => {
    appels.push([`${id}:advisor:${n}`, { ...base, modele: famille(e.model), ...compteurs(e, null) }]);
  });
  return appels;
}

const rattachement = ({ ts, projet, session, sousAgent }) => ({ ts, projet, session, sousAgent });

// Garde la réponse au plus grand compteur de sortie ; à sortie égale, compteurs relus, rattachement d'origine gardé
function garder(appels, id, appel) {
  const precedent = appels.get(id);
  if (!precedent || appel.sortie > precedent.sortie) appels.set(id, appel);
  else if (appel.sortie === precedent.sortie) appels.set(id, { ...appel, ...rattachement(precedent) });
}

// Ligne de compactage (type system, subtype compact_boundary) → { ts, session, declencheur, avant, apres }, ou null.
// Seuls l'heure, le déclencheur (manual / auto) et les tailles avant / après sont gardés.
export function compactageDeLaLigne(o, session) {
  if (o?.type !== 'system' || o.subtype !== 'compact_boundary' || !horodate(o)) return null;
  const m = o.compactMetadata && typeof o.compactMetadata === 'object' ? o.compactMetadata : {};
  const nombre = v => Number.isFinite(v) ? v : null;
  return {
    ts: o.timestamp, session, declencheur: m.trigger === 'auto' || m.trigger === 'manual' ? m.trigger : 'inconnu',
    avant: nombre(m.preTokens), apres: nombre(m.postTokens),
  };
}

const LIMITE = /hit your (session|weekly) limit · resets (\d{1,2})(?::(\d\d))?(am|pm)/;
const horodate = o => Number.isFinite(Date.parse(o.timestamp));

// Lit les journaux et complète les Map de l'archive :
// - appels : clé = id du message (une réponse peut occuper plusieurs lignes : on garde le plus grand compteur de
//   sortie, celui du dernier bloc) ; à sortie égale, la réponse déjà connue reprend les compteurs de la ligne lue (un
//   journal encore présent corrige ainsi l'archive, #14) mais garde son rattachement : heure, dossier, session et
//   sous-agent (une session reprise recopie les messages de l'originale) ; l'étape du conseiller suit celui de sa
//   réponse principale ;
// - limites : messages de blocage, clé = horodatage + type (une reprise de session recopie les messages) ;
// - releves : % écrits par l'appli (rate_limit_event), clé = uuid ;
// - compactages : lignes compact_boundary de la conversation principale (pas des sous-agents), clé = uuid.
// fichiers : [{ f, racine, cowork }]. Rend le nombre de lignes « usage » lues et illisibles.
export async function lireJournaux(fichiers, { appels, limites, releves, compactages = new Map() }, nomProjet) {
  let lignes = 0, illisibles = 0;
  for (const { f, racine, cowork } of fichiers) {
    // Claude Code : <clé du dossier>/<session>.jsonl (ou <session>/subagents/…) ; Cowork : <compte>/<org>/<session>/…
    const rel = relative(racine, f).split(sep);
    const projet = cowork ? 'Cowork' : nomProjet(rel[0]);
    let session = basename(f, '.jsonl');
    if (cowork) session = 'cw-' + (rel[2]?.replace(/^local_/, '') ?? session);
    else if (rel.length > 2) session = rel[1];
    const sousAgent = rel.includes('subagents');
    const agent = sousAgent ? basename(f, '.jsonl') : null;

    for await (const l of createInterface({ input: createReadStream(f, 'utf8'), crlfDelay: Infinity })) {
      if (l.includes('"rate_limit_event"')) {
        try {
          const o = JSON.parse(l), w = o.rate_limit_info?.unifiedWindows;
          if (o.type === 'rate_limit_event' && w && horodate(o)) {
            releves.set(o.uuid ?? o.timestamp, { ts: o.timestamp, w });
          }
        } catch { /* ligne tronquée */ }
        continue;
      }
      // Forme exacte, non échappée : un message qui cite ce mot dans son texte ne la contient pas. Une ligne qui n'est
      // pas un compactage continue vers la lecture des compteurs.
      if (l.includes('"subtype":"compact_boundary"')) {
        let c = null, o;
        try {
          o = JSON.parse(l);
          c = compactageDeLaLigne(o, session);
        } catch { /* ligne tronquée */ }
        if (c) {
          if (!sousAgent) compactages.set(o.uuid ?? o.timestamp + session, c);
          continue;
        }
      }
      if (!l.includes('"usage"')) continue;
      lignes++;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        illisibles++;
        continue;
      }
      const m = o.message;
      if (m?.model === '<synthetic>') {
        if (!horodate(o)) continue; // sans horodatage, la remise à zéro est incalculable
        const texte = (Array.isArray(m.content) ? m.content : []).map(c => String(c?.text ?? '')).join(' ');
        const lim = texte.match(LIMITE);
        if (lim) {
          const type = lim[1] === 'weekly' ? 'hebdo' : '5h';
          const h = (+lim[2] % 12) + (lim[4] === 'pm' ? 12 : 0);
          limites.set(o.timestamp + lim[1], { ts: o.timestamp, type, h, min: +(lim[3] || 0) });
        }
        continue;
      }
      if (o.type !== 'assistant' || !m?.usage || !m.model) continue;
      if (!horodate(o)) { // sans horodatage : ni jour ni semaine
        illisibles++;
        continue;
      }
      const [[id, principal], ...conseiller] = appelsDeLaLigne(o, { projet, session, sousAgent, agent });
      garder(appels, id, principal);
      const lien = rattachement(appels.get(id));
      for (const [idConseiller, appel] of conseiller) {
        garder(appels, idConseiller, appel);
        appels.set(idConseiller, { ...appels.get(idConseiller), ...lien });
      }
    }
  }
  return { lignes, illisibles };
}

// Fichier des relevés à la main : readings.json (nom anglais) ou releves.json (ancien nom), jamais les deux. Un dossier
// homonyme ne compte pas. À appeler avant toute écriture : l'erreur doit arrêter le passage avant l'archive.
export function choisirFichierReleves(dossier) {
  const estFichier = p => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
  const anglais = estFichier(join(dossier, 'readings.json')), ancien = estFichier(join(dossier, 'releves.json'));
  if (anglais && ancien) throw new Error(`readings.json et releves.json présents dans ${dossier} : n'en garder qu'un`);
  return join(dossier, anglais ? 'readings.json' : 'releves.json');
}

// Relevés à la main : % notés par vous ou par un outil, [{ ts, hebdo, hebdoReset, cinqH, cinqHReset }, …] (README).
// Illisible ou pas une liste : ignoré et signalé ; une entrée sans date valable est écartée.
export function lireRelevesManuels(fichier) {
  const nom = basename(fichier);
  let releves = [];
  try {
    releves = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`ATTENTION : ${nom} illisible, ignoré (${e.message})`);
  }
  if (!Array.isArray(releves)) {
    console.error(`ATTENTION : ${nom} doit contenir une liste [ … ], ignoré`);
    releves = [];
  }
  return releves.filter(r => r && typeof r.ts === 'string' && Number.isFinite(Date.parse(r.ts)));
}

// Relevés rate_limit_event de l'archive, au format de releves.json (% entier, resets en ISO)
export function relevesDeLAppli(releves) {
  const isoSecondes = s => {
    const t = new Date(s * 1000);
    return s && Number.isFinite(t.getTime()) ? t.toISOString() : null;
  };
  const pct = fenetre => fenetre ? Math.round(fenetre.utilization * 100) : null;
  return [...releves.values()].map(({ ts, w }) => ({
    ts, source: 'rate_limit_event',
    hebdo: pct(w.seven_day), hebdoReset: isoSecondes(w.seven_day?.resetsAt),
    cinqH: pct(w.five_hour), cinqHReset: isoSecondes(w.five_hour?.resetsAt),
  }));
}

// Journal du mod sonar (option quotaLog) : une ligne par changement de % ou d'heure de remise à zéro. Absent : aucun.
export function lireSonar(fichier) {
  const releves = [];
  try {
    for (const l of readFileSync(fichier, 'utf8').split('\n')) {
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue;
      }
      if (!Number.isFinite(Date.parse(o?.ts))) continue;
      releves.push({
        ts: o.ts, source: 'sonar',
        hebdo: o.seven_day?.pct ?? null, hebdoReset: o.seven_day?.resets_at ?? null,
        cinqH: o.five_hour?.pct ?? null, cinqHReset: o.five_hour?.resets_at ?? null,
      });
    }
  } catch { /* pas de journal sonar */ }
  return releves;
}
