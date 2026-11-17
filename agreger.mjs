// Agrège les compteurs de jetons des journaux Claude Code (~/.claude/projects/**/*.jsonl).
// Lit seulement les champs usage / model / timestamp / chemin : jamais le contenu des messages.
// Usage : node agreger.mjs [--output chemin.json] [--logs dossier]...   (défaut : donnees.json dans le dossier des données)
//   --logs (ancien nom : --journaux) : dossier « projects » supplémentaire au format Claude Code (ex. copie venue d'un autre PC), répétable.
//   --output (ancien nom : --sortie) ; --quota-log (ancien nom : --journal-quota) : voir plus bas.
// Données (donnees.json, archive, releves.json) : dossier « dataDir » (ancien nom : dossierDonnees) de config.local.json (voir config.mjs).
// Archive (archive-appels.json, dans le dossier des données) : compteurs de chaque réponse déjà vue, complétée à chaque passage.
// Claude Code efface les journaux non modifiés depuis cleanupPeriodDays jours (30 par défaut) : l'archive garde leurs compteurs.
import { readdirSync, statSync, createReadStream, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join, basename, relative, sep, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { DONNEES, nomProjet, REMISE_A_ZERO, RESETS, RESETS_PRECIS, MODE, BASE, TARIFS_ECRITS, TARIFS_LIVRES } from './config.mjs';
import { fabriquer } from './semaine.mjs';

// Deux sources : Claude Code (~/.claude/projects) et Cowork (sessions locales de Claude Desktop,
// AppData/Local/Claude-Data/claude_*/local-agent-mode-sessions), même format de journal. Cowork n'écrit plus de journal ici depuis fin octobre 2026 : son usage passe en hors PC ; le dossier n'est lu que pour l'historique.
const racine = join(homedir(), '.claude', 'projects');
const racinesCowork = (() => {
  const base = join(homedir(), 'AppData', 'Local', 'Claude-Data');
  try {
    return readdirSync(base).filter(n => n.startsWith('claude_')).map(n => join(base, n, 'local-agent-mode-sessions'))
      .filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
})();
// Option et son ancien nom français (lot 1, 17/11) : les deux ensemble = arrêt. Rend l'indice du nom trouvé, sinon -1.
function indiceOption(nouveau, ancien) {
  const n = process.argv.indexOf(nouveau), a = process.argv.indexOf(ancien);
  if (n > 0 && a > 0) throw new Error(`${nouveau} et ${ancien} : deux noms de la même option, n'en garder qu'un`);
  return Math.max(n, a);
}
const iSortie = indiceOption('--output', '--sortie');
const sortie = iSortie > 0 ? process.argv[iSortie + 1] : join(DONNEES, 'donnees.json');
// Journal quota (--quota-log / --journal-quota) : contrôlé ici, avant toute écriture de l'archive
const iJournal = indiceOption('--quota-log', '--journal-quota');
const racinesEnPlus = [...new Set(process.argv.flatMap((v, i) => {
  if (v !== '--logs' && v !== '--journaux') return [];
  const r = process.argv[i + 1];
  if (!r || r.startsWith('--')) throw new Error(`${v} : il manque le dossier`);
  if (!statSync(r, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${v} : dossier introuvable : ${r}`);
  return [resolve(r)];
}))].filter(r => r !== resolve(racine)); // le dossier par défaut est déjà lu
const fichierArchive = join(DONNEES, 'archive-appels.json');
// Relevés à la main (lot 1, 17/11) : readings.json (nom anglais) ou releves.json (ancien nom), jamais les deux.
// Contrôlé avant toute écriture (l'archive est réécrite plus bas).
const fichierReleves = (() => {
  const estFichier = p => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false; // un dossier homonyme ne compte pas
  const n = estFichier(join(DONNEES, 'readings.json')), a = estFichier(join(DONNEES, 'releves.json'));
  if (n && a) throw new Error(`readings.json et releves.json présents dans ${DONNEES} : n'en garder qu'un`);
  return join(DONNEES, n ? 'readings.json' : 'releves.json');
})();
if (!existsSync(racine) && !racinesEnPlus.length && !racinesCowork.length) {
  console.error(`Aucun journal Claude Code dans ${racine} : lancer d'abord une session Claude Code, ou indiquer --logs <dossier>.`);
  process.exit(1);
}

function lister(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...lister(p));
    else if (nom.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// Nom lisible du dossier de travail : règles de config.local.json (motifProjet, renommerProjets)
const projet = nomProjet;

// claude-opus-4-6, claude-opus-4-1-20250805 → « Opus 4.6 », « Opus 4.1 » ; ancien ordre claude-3-7-sonnet-20250219 → « Sonnet 3.7 » ;
// suffixe « [1m] » ou « :… » ignoré (13/11, relecture DeepSeek). Autre forme : nom brut, signalé « sans tarif ».
function famille(model) {
  const id = model.replace(/\[.*\]$|:.*$/, '');
  const FAM = 'opus|sonnet|haiku|fable|mythos', VER = '\\d+(?:-\\d)?', DATE = '(?:-\\d{8})?$';
  let fam, ver, m;
  if ((m = id.match(new RegExp(`^claude-(${FAM})-(${VER})${DATE}`)))) [, fam, ver] = m;
  else if ((m = id.match(new RegExp(`^claude-(${VER})-(${FAM})${DATE}`)))) [, ver, fam] = m;
  else return model;
  return fam[0].toUpperCase() + fam.slice(1) + ' ' + ver.replaceAll('-', '.');
}

// Tarifs API $/million de jetons : entrée, sortie, lecture cache (page Pricing officielle, lue le 2026-11-13 ;
// 13/11 : Fable ajouté, lecture cache Sonnet 5.5 corrigée 0,20 → 0,10, palier Haiku 5.5 ajouté).
// Écriture cache : 1,25 × entrée (5 min) ou 2 × entrée (1 h), vérifié pour tous ces modèles. Estimation : le forfait ne se facture pas ainsi.
// Liste complète générée par maj-tarifs.mjs dans tarifs.json (13/11) : elle prime ; la liste ci-dessous sert de repli si le
// fichier manque. Nouveau modèle : relancer node maj-tarifs.mjs (sinon coût 0 $ signalé en fin d'agrégation).
const INTEGRES = {
  'Fable 5.2': [8, 40, 0.20], 'Fable 5.1': [10, 50, 0.25], 'Fable 5': [10, 50, 1],
  'Opus 5.5': [4, 20, 0.20], 'Opus 4.8': [5, 25, 0.50], 'Sonnet 5.5': [2, 10, 0.10],
  'Sonnet 5': [2, 10, 0.20], 'Haiku 5.5': [0.10, 0.50, 0.01], 'Haiku 4.5': [1, 5, 0.10],
};
// Haiku 5.5 : prompt (entrée + écriture cache + lecture cache) > 100 000 jetons → TOUTE la requête au tarif haut
// (page Pricing, « Long context pricing » : chaque requête est tarifée seule, même si une partie est lue du cache).
const PALIERS_INTEGRES = { 'Haiku 5.5': { seuil: 100000, tarif: [0.50, 2.50, 0.05] } };
// tarifs.json écrit par maj-tarifs.mjs (dossier de base) d'abord, sinon celui livré avec le code (identiques pour un clone)
const fichierTarifs = (() => {
  for (const f of [...new Set([TARIFS_ECRITS, TARIFS_LIVRES])]) {
    try { return JSON.parse(readFileSync(f, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') console.log(`ATTENTION : ${f} illisible (${e.message}) : ignoré`); }
  }
  return {}; // aucun fichier lisible : tarifs intégrés
})();
// Entrée valide = 3 nombres finis ≥ 0 ; une entrée invalide est ignorée (le tarif intégré reste) et signalée
const tarifValide = t => Array.isArray(t) && t.length === 3 && t.every(v => Number.isFinite(v) && v >= 0);
const TARIFS = { ...INTEGRES };
for (const [m, t] of Object.entries(fichierTarifs.tarifs ?? {})) {
  if (tarifValide(t)) TARIFS[m] = t; else console.log(`ATTENTION : tarifs.json, tarif invalide pour ${m} : ignoré`);
}
// Paliers : pour un modèle tarifé par tarifs.json, seuls ses paliers à lui comptent (un palier retiré de la page disparaît)
const PALIERS = Object.fromEntries(Object.entries(PALIERS_INTEGRES).filter(([m]) => !(m in (fichierTarifs.tarifs ?? {}))));
for (const [m, p] of Object.entries(fichierTarifs.paliers ?? {})) {
  if (Number.isFinite(p?.seuil) && p.seuil > 0 && tarifValide(p.tarif)) PALIERS[m] = p; else console.log(`ATTENTION : tarifs.json, palier invalide pour ${m} : ignoré`);
}
const sansTarif = new Set();
function cout(a) {
  const palier = PALIERS[a.modele];
  const haut = palier && a.entree + a.ecritureCache + a.lectureCache > palier.seuil;
  if (!TARIFS[a.modele]) sansTarif.add(a.modele);
  const [e, s, l] = haut ? palier.tarif : TARIFS[a.modele] ?? [0, 0, 0];
  a.coutEntree = a.entree * e / 1e6;
  a.coutEcriture = (a.ecriture5m * 1.25 + a.ecriture1h * 2) * e / 1e6;
  a.coutLecture = a.lectureCache * l / 1e6;
  a.coutSortie = a.sortie * s / 1e6;
  return a.coutEntree + a.coutEcriture + a.coutLecture + a.coutSortie;
}

// Fenêtre hebdomadaire du forfait : cycle de 7 × 24 h ouvert au jour et à l'heure UTC de REMISE_A_ZERO
// (config.local.json, clé remiseAZero ; défaut dimanche 10:00 UTC, README « Limites »).
const { debutSemaine, instantDebut } = fabriquer(REMISE_A_ZERO);

// Resets précis (clé resets, nouvelle forme) : ils coupent la fenêtre en segments. Début du segment d'un instant t = le dernier
// reset précis de sa fenêtre (début = W) qui est ≤ t, sinon le début de la fenêtre W (decision 3 du plan #5, 15/11).
const SEMAINE_MS = 7 * 864e5;
// Un reset à l'instant exact du début de semaine ne coupe rien : il est ignoré (sinon il crée un segment vide, relecture 3, 16/11)
const precisDans = W => RESETS_PRECIS.map(p => p.quand).filter(q => q > W && q < W + SEMAINE_MS);
const segmentDe = (t, W) => Math.max(W, ...precisDans(W).filter(q => q <= t));
const ISO = ms => new Date(ms).toISOString();

const jour = ts => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const heure = ts => Number(new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }));

const appels = new Map(); // clé = message.id : une réponse peut occuper plusieurs lignes
const limites = new Map(); // clé = horodatage + type : un même message peut être recopié par une reprise de session
// Relevés du % écrits par l'appli (rate_limit_event, surtout dans les journaux Cowork jusqu'à fin octobre 2026) : clé = uuid
const relevesAuto = new Map();
let lignes = 0, illisibles = 0;

// Archive des passages précédents : même format que les Map ci-dessus. Illisible → arrêt, pour ne jamais l'écraser par moins.
let archive = { appels: {}, limites: {}, releves: {} };
try { archive = JSON.parse(readFileSync(fichierArchive, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw new Error(`archive illisible, rien n'est écrit : ${fichierArchive} (${e.message})`);
  // Paquet npm, premier passage (issue #19) : l'archive d'un clone éventuel n'est pas reprise d'elle-même
  if (MODE === 'paquet') console.log(`Info : nouvelle archive des compteurs créée dans ${DONNEES}. Si vous aviez un clone de conso-tokens, `
    + `copiez son config.local.json dans ${BASE} et, si ses données étaient dans son dossier data/ ou donnees/ (défaut) ou à un chemin relatif `
    + `(dataDir), copiez aussi ce dossier de données dans ${DONNEES}, et son tarifs.json s'il a été mis à jour, `
    + `AVANT le prochain passage, pour garder son historique.`);
}
const objet = o => o && typeof o === 'object' && !Array.isArray(o);
if (!objet(archive) || !['appels', 'limites', 'releves'].every(k => objet(archive[k])))
  throw new Error(`archive de forme inattendue, rien n'est écrit : ${fichierArchive}`);
for (const [k, v] of Object.entries(archive.appels)) appels.set(k, v);
for (const [k, v] of Object.entries(archive.limites)) limites.set(k, v);
for (const [k, v] of Object.entries(archive.releves)) relevesAuto.set(k, v);
const dejaArchives = appels.size;

const fichiers = [
  ...(existsSync(racine) ? lister(racine) : []).map(f => ({ f, racine, cowork: false })),
  ...racinesEnPlus.flatMap(r => lister(r).map(f => ({ f, racine: r, cowork: false }))),
  ...racinesCowork.flatMap(r => lister(r).map(f => ({ f, racine: r, cowork: true }))),
];
for (const { f, racine: rac, cowork } of fichiers) {
  const rel = relative(rac, f).split(sep);
  // Cowork : <compte>/<organisation>/<dossier de session>/… ; Claude Code : <clé du dossier>/<session>.jsonl
  const cle = cowork ? 'Cowork' : rel[0];
  const session = cowork ? 'cw-' + (rel[2]?.replace(/^local_/, '') ?? basename(f, '.jsonl')) : rel.length > 2 ? rel[1] : basename(f, '.jsonl');
  const sousAgent = rel.includes('subagents');
  const rl = createInterface({ input: createReadStream(f, 'utf8'), crlfDelay: Infinity });
  for await (const l of rl) {
    if (l.includes('"rate_limit_event"')) {
      try {
        const o = JSON.parse(l), w = o.rate_limit_info?.unifiedWindows;
        if (o.type === 'rate_limit_event' && w && Number.isFinite(Date.parse(o.timestamp))) relevesAuto.set(o.uuid ?? o.timestamp, { ts: o.timestamp, w });
      } catch { /* ligne tronquée */ }
      continue;
    }
    if (!l.includes('"usage"')) continue;
    lignes++;
    let o;
    try { o = JSON.parse(l); } catch { illisibles++; continue; }
    const m = o.message;
    // Message de l'appli « You've hit your session/weekly limit · resets 7pm (Europe/Paris) » : compteur plein à cet instant
    if (m?.model === '<synthetic>') {
      if (!Number.isFinite(Date.parse(o.timestamp))) continue; // sans horodatage, la remise à zéro est incalculable
      const txt = (Array.isArray(m.content) ? m.content : []).map(c => String(c?.text ?? '')).join(' ');
      const lim = txt.match(/hit your (session|weekly) limit · resets (\d{1,2})(?::(\d\d))?(am|pm)/);
      if (lim) limites.set(o.timestamp + lim[1], { ts: o.timestamp, type: lim[1] === 'weekly' ? 'hebdo' : '5h', h: (+lim[2] % 12) + (lim[4] === 'pm' ? 12 : 0), min: +(lim[3] || 0) });
      continue;
    }
    if (o.type !== 'assistant' || !m?.usage || !m.model) continue;
    if (!Number.isFinite(Date.parse(o.timestamp))) { illisibles++; continue; } // sans horodatage : ni jour ni semaine
    const id = m.id || o.requestId || o.uuid;
    const u = m.usage;
    const a = {
      ts: o.timestamp, projet: cowork ? 'Cowork' : projet(cle), session, sousAgent: sousAgent || !!o.isSidechain,
      modele: famille(m.model),
      entree: u.input_tokens || 0,
      ecritureCache: u.cache_creation_input_tokens || 0,
      ecriture1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      ecriture5m: u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens || 0),
      lectureCache: u.cache_read_input_tokens || 0,
      sortie: u.output_tokens || 0,
      reflexion: u.output_tokens_details?.thinking_tokens || 0,
    };
    const prec = appels.get(id);
    // Doublon : garder le compteur de sortie le plus élevé (dernier bloc de la réponse)
    if (!prec || a.sortie > prec.sortie) appels.set(id, a);
  }
}

// Archive réécrite avant tout calcul de coût (les objets restent sans champs cout*) : fichier temporaire puis renommage
const tmpArchive = `${fichierArchive}.${process.pid}.tmp`;
writeFileSync(tmpArchive, JSON.stringify({
  majLe: new Date().toISOString(),
  appels: Object.fromEntries(appels), limites: Object.fromEntries(limites), releves: Object.fromEntries(relevesAuto),
}));
renameSync(tmpArchive, fichierArchive);

const CUMULS = ['entree', 'ecritureCache', 'lectureCache', 'sortie', 'reflexion', 'cout', 'coutEntree', 'coutEcriture', 'coutLecture', 'coutSortie'];
const vide = () => ({ ...Object.fromEntries(CUMULS.map(k => [k, 0])), appels: 0 });
const ajouter = (t, a) => { for (const k of CUMULS) t[k] += a[k]; t.appels++; };
const parJour = {}, parProjet = {}, parModele = {}, parHeure = Array.from({ length: 24 }, vide), parSession = {}, parSemaine = {};
const jourModele = {}, jourProjet = {}, jourModeleTotal = {}, jourTailles = {};
const tailles = [0, 0, 0, 0, 0]; // contexte par appel : <50k, 50-100k, 100-150k, 150-250k, >250k
const total = vide();

for (const a of appels.values()) {
  const j = jour(a.ts);
  a.cout = cout(a);
  ajouter(total, a);
  const sem = (parSemaine[debutSemaine(a.ts)] ??={ ...vide(), modeles: {}, jetonsModeles: {} });
  ajouter(sem, a);
  sem.modeles[a.modele] = (sem.modeles[a.modele] || 0) + a.cout;
  sem.jetonsModeles[a.modele] = (sem.jetonsModeles[a.modele] || 0) + a.entree + a.ecritureCache + a.lectureCache + a.sortie;
  ajouter(parJour[j] ??= vide(), a);
  ajouter(parProjet[a.projet] ??= vide(), a);
  ajouter((jourProjet[j] ??= {})[a.projet] ??= vide(), a); // pour filtrer les dossiers par période (page, 07/11)
  ajouter((jourModeleTotal[j] ??= {})[a.modele] ??= vide(), a); // idem pour « Par modèle » (07/11)
  ajouter(parModele[a.modele] ??= vide(), a);
  ajouter(parHeure[heure(a.ts)], a);
  const jm = (jourModele[j] ??= {});
  jm[a.modele] = (jm[a.modele] || 0) + a.entree + a.ecritureCache + a.lectureCache + a.sortie;
  const ctx = a.entree + a.ecritureCache + a.lectureCache;
  const tranche = ctx < 50e3 ? 0 : ctx < 100e3 ? 1 : ctx < 150e3 ? 2 : ctx < 250e3 ? 3 : 4;
  tailles[tranche]++;
  (jourTailles[j] ??= [0, 0, 0, 0, 0])[tranche]++; // idem pour « Taille du contexte » (07/11)
  const s = (parSession[a.session] ??= { ...vide(), projet: a.projet, debut: a.ts, fin: a.ts, ctxMax: 0, sousAgents: 0, modeles: {} });
  ajouter(s, a);
  if (a.ts < s.debut) s.debut = a.ts;
  if (a.ts > s.fin) s.fin = a.ts;
  if (!a.sousAgent && ctx > s.ctxMax) s.ctxMax = ctx;
  if (a.sousAgent) s.sousAgents += a.entree + a.ecritureCache + a.lectureCache + a.sortie;
  s.modeles[a.modele] = (s.modeles[a.modele] || 0) + 1;
}

// Plafonds observés : coût consommé entre l'ouverture de la fenêtre et le message de limite.
// Ouverture = remise à zéro annoncée moins la durée de la fenêtre (5 h, ou 7 jours pour l'hebdo).
const parisVersUtc = (base, h, min) => { // prochaine occurrence de h:min heure de Paris après base
  for (let k = 1; k <= 24 * 60; k++) { // pas d'une minute, sur 24 h
    const t = new Date(Math.floor(base / 6e4) * 6e4 + k * 6e4);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t).map(x => [x.type, x.value]));
    if (t.getTime() > base && +p.hour === h && +p.minute === min) return t.getTime();
  }
  return null;
};
const tri = [...appels.values()].sort((a, b) => a.ts < b.ts ? -1 : 1);
const vus = new Set();
const plafonds = [...limites.values()].sort((a, b) => a.ts < b.ts ? -1 : 1).map(l => {
  const atteinte = Date.parse(l.ts);
  const reset = l.type === 'hebdo'
    ? instantDebut(debutSemaine(atteinte + 7 * 864e5))
    : parisVersUtc(atteinte, l.h, l.min);
  if (reset === null) return null;
  const debut = reset - (l.type === 'hebdo' ? 7 * 864e5 : 5 * 36e5);
  // Coût compté depuis le début du segment où la limite est atteinte (= début de fenêtre sans reset précis)
  const debutSeg = l.type === 'hebdo' ? segmentDe(atteinte, debut) : debut;
  // Même segment déjà compté : message répété. Par segment (pas par fenêtre) : un second message après un reset précis compte (relecture 2, 16/11)
  if (vus.has(l.type + debutSeg)) return null;
  vus.add(l.type + debutSeg);
  const dans = tri.filter(a => { const t = Date.parse(a.ts); return t >= debutSeg && t <= atteinte; });
  return { type: l.type, atteinte: l.ts, debutFenetre: ISO(debut), debutSegment: ISO(debutSeg), reset: ISO(reset),
    cout: Math.round(dans.reduce((s, a) => s + a.cout, 0) * 100) / 100, appels: dans.length,
    jetonsSortie: dans.reduce((s, a) => s + a.sortie, 0) };
}).filter(Boolean);

// Relevés du % affiché par l'appli (releves.json, tenu à la main ou par un outil) : plafond projeté = coût / %
const coutEntre = (debut, fin) => tri.reduce((s, a) => { const t = Date.parse(a.ts); return t >= debut && t <= fin ? s + a.cout : s; }, 0);
const sortieEntre = (debut, fin) => tri.reduce((s, a) => { const t = Date.parse(a.ts); return t >= debut && t <= fin ? s + a.sortie : s; }, 0);
let releves = [];
// Format : [{ "ts": "ISO", "hebdo": %, "hebdoReset": "ISO", "cinqH": %, "cinqHReset": "ISO" }, …] (README, « releves.json »)
try { releves = JSON.parse(readFileSync(fichierReleves, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') console.error(`ATTENTION : ${basename(fichierReleves)} illisible, ignoré (${e.message})`); }
if (!Array.isArray(releves)) { console.error(`ATTENTION : ${basename(fichierReleves)} doit contenir une liste [ … ], ignoré`); releves = []; }
releves = releves.filter(r => r && typeof r.ts === 'string' && Number.isFinite(Date.parse(r.ts)));
// Relevés de l'appli convertis au même format (pct en %, resets en ISO). Un % sous 10 rend la division trop bruitée :
// il est gardé pour la trace mais ne sert pas aux plafonds (filtre par métrique, dans projections).
for (const { ts, w } of relevesAuto.values()) {
  const iso = s => { const t = new Date(s * 1000); return s && Number.isFinite(t.getTime()) ? t.toISOString() : null; };
  releves.push({ ts, source: 'rate_limit_event', hebdo: w.seven_day ? Math.round(w.seven_day.utilization * 100) : null,
    hebdoReset: iso(w.seven_day?.resetsAt), cinqH: w.five_hour ? Math.round(w.five_hour.utilization * 100) : null, cinqHReset: iso(w.five_hour?.resetsAt) });
}
// Journal du mod sonar (option quotaLog) : une ligne par changement de % ou d'heure de remise à zéro.
// Autre chemin (quotaLogPath de sonar) : --journal-quota chemin.jsonl
const journalQuota = iJournal > 0 ? process.argv[iJournal + 1] : join(homedir(), '.claude', 'sonar', 'quota-log.jsonl');
let lignesSonar = 0;
try {
  for (const l of readFileSync(journalQuota, 'utf8').split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!Number.isFinite(Date.parse(o?.ts))) continue;
    releves.push({ ts: o.ts, source: 'sonar', hebdo: o.seven_day?.pct ?? null, hebdoReset: o.seven_day?.resets_at ?? null,
      cinqH: o.five_hour?.pct ?? null, cinqHReset: o.five_hour?.resets_at ?? null });
    lignesSonar++;
  }
} catch { /* pas de journal sonar */ }
releves = releves.filter(r => r.hebdo >= 10 || r.cinqH >= 10).sort((a, b) => a.ts < b.ts ? -1 : 1);
const projections = releves.flatMap(r => {
  const t = Date.parse(r.ts), out = [];
  for (const [type, pct, reset, duree] of [['hebdo', r.hebdo, r.hebdoReset, 7 * 864e5], ['5h', r.cinqH, r.cinqHReset, 5 * 36e5]]) {
    if (!(pct >= 10) || !Number.isFinite(Date.parse(reset))) continue; // % trop bas ou reset illisible : métrique ignorée
    const debut = Date.parse(reset) - duree;
    const debutSeg = type === 'hebdo' ? segmentDe(t, debut) : debut; // coût du relevé depuis le segment (reset précis)
    const c = coutEntre(debutSeg, t), so = sortieEntre(debutSeg, t);
    out.push({ type, releve: r.ts, pct, debutFenetre: ISO(debut), debutSegment: ISO(debutSeg), coutAuReleve: Math.round(c * 100) / 100,
      plafondProjete: Math.round(c / (pct / 100) * 100) / 100, sortieProjetee: Math.round(so / (pct / 100)) });
  }
  return out;
});

// jour / jourFin = jour du début / de la dernière réponse, en heure de Paris (même découpe que parJour) : filtre par période
// de la page (une session compte dans la période si elle y a commencé ; le max de jourFin = dernier jour des données)
const sessions = Object.entries(parSession).map(([id, s]) => ({ id: id.slice(0, 8), jour: jour(s.debut), jourFin: jour(s.fin), ...s }));
// Semaines coupées par un reset précis seulement : coût et jetons de sortie de chaque segment (source pour exporter.mjs)
const segmentsHebdo = [...new Set(RESETS_PRECIS.filter(p => p.quand > instantDebut(p.semaine)).map(p => p.semaine))].sort().flatMap(semaine => {
  const W = instantDebut(semaine), bornes = [W, ...precisDans(W).sort((a, b) => a - b), W + SEMAINE_MS];
  return bornes.slice(0, -1).map((s, i) => {
    const e = bornes[i + 1], dans = tri.filter(a => { const t = Date.parse(a.ts); return t >= s && t < e; });
    return { semaine, debut: ISO(s), fin: ISO(e), cout: Math.round(dans.reduce((x, a) => x + a.cout, 0) * 100) / 100,
      sortie: dans.reduce((x, a) => x + a.sortie, 0) };
  });
});
// Resets déclarés (config.local.json) : controles.mjs lit precis (instants en ISO) ; exporter.mjs reconstruit la table resets depuis RESETS / RESETS_PRECIS
const resetsDeclares = { semaines: RESETS, precis: RESETS_PRECIS.map(p => ({ quand: ISO(p.quand), type: p.type, note: p.note, semaine: p.semaine })) };
writeFileSync(sortie, JSON.stringify({
  genereLe: new Date().toISOString(), lignesUsage: lignes, illisibles, reponsesUniques: appels.size,
  reset: { jour: REMISE_A_ZERO.jour, heureUTC: REMISE_A_ZERO.heureUTC, fuseau: 'UTC' }, tarifs: TARIFS, paliers: PALIERS,
  total, plafonds, projections, segmentsHebdo, resetsDeclares, parSemaine, parJour, jourModele, jourProjet, jourModeleTotal, jourTailles, parProjet, parModele, parHeure, tailles, sessions,
}, null, 1));
console.log(`${appels.size} réponses uniques (${lignes} lignes « usage », ${illisibles} illisibles), ${sessions.length} sessions, ${lignesSonar} relevés sonar -> ${sortie}`);
console.log(`archive : ${dejaArchives} réponses déjà connues, ${appels.size - dejaArchives} nouvelles -> ${fichierArchive}`);
if (sansTarif.size) console.log(`ATTENTION : modèle(s) sans tarif, comptés à 0 $ : ${[...sansTarif].join(", ")} → les ajouter à TARIFS`);
