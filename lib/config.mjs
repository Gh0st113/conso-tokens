// Réglages propres à chaque utilisateur : config.local.json dans le dossier de base (ignoré par git ; modèle : config.exemple.json).
// Dossier de base (issue #19, choisirBase dans reglages.mjs) : celui des scripts pour un clone, ~/.conso-tokens pour le
// paquet npm, ou CONSO_TOKENS_DIR. Sans config.local.json, tout marche avec les valeurs par défaut ci-dessous.
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { lireCycle, lireResets, lireForfaits, lireCache, choisirBase, nomsAnciens, choisirDossierDonnees } from './reglages.mjs';
import { fabriquer } from './semaine.mjs';

// Dossier du code = racine du paquet (ce fichier est dans lib/) : clone ou paquet, tarifs livrés, garde-fous
export const ici = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const choix = choisirBase({ ici, existe: existsSync, env: process.env, maison: homedir(), joindre: join });
export const MODE = choix.mode;
export const BASE = resolve(choix.base);
// Tarifs : celui livré avec le code (lecture seule en mode paquet) et celui que maj-tarifs.mjs écrit (prioritaire)
export const TARIFS_LIVRES = join(ici, 'tarifs.json');
export const TARIFS_ECRITS = join(BASE, 'tarifs.json');
const erreur = m => { throw new Error(`config.local.json : ${m}`); };
let c = {};
try { c = JSON.parse(readFileSync(join(BASE, 'config.local.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') erreur(`illisible (${e.message})`); }
if (c === null || typeof c !== 'object' || Array.isArray(c)) erreur('doit contenir un objet { … }');
// Noms anglais (lot 1, 17/11) ramenés aux anciens noms : tout le reste du fichier lit les mêmes clés qu'avant
try { c = nomsAnciens(c); } catch (e) { erreur(e.message); }
const texte = (k, v) => { if (typeof v !== 'string' || !v) erreur(`« ${k} » doit être un texte non vide`); return v; };
const regex = (k, v) => { try { return new RegExp(texte(k, v), 'i'); } catch (e) { erreur(`« ${k} » n'est pas une expression régulière valide (${e.message})`); } };
// « ~ » seul ou « ~/… » = dossier personnel ; « ~autre » refusé (sens ambigu)
const chemin = (k, p) => {
  texte(k, p);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(1));
  if (p.startsWith('~')) erreur(`« ${k} » : seuls « ~ » et « ~/… » sont acceptés`);
  return resolve(BASE, p);
};

// Dossier des données (donnees.json, archive-appels.json, releves.json, export/) : hors du dépôt de préférence.
// Sans chemin explicite (dataDir ou dossierDonnees) : data/, ou donnees/ s'il est seul à exister (choisirDossierDonnees).
const DOSSIERS_DONNEES = ['data', 'donnees'];
export const DONNEES = c.dossierDonnees === undefined
  ? join(BASE, (() => {
    try { return choisirDossierDonnees({ base: BASE, existe: p => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false, joindre: join }); }
    catch (e) { throw new Error(`conso-tokens : ${e.message}`); }
  })())
  : chemin('dossierDonnees', c.dossierDonnees);
// Garde-fou, dans tous les modes : dans le dossier du code, les données ne vont QUE dans data/ ou donnees/ (ignorés par git) ;
// ailleurs, elles pourraient être commitées et publiées, ou écrasées par une mise à jour du paquet → refus
const dansCode = p => { const r = relative(ici, p); return !(isAbsolute(r) || r === '..' || r.startsWith('..' + sep) || r.startsWith('../')); };
const rel = relative(ici, DONNEES);
if (dansCode(DONNEES) && !DOSSIERS_DONNEES.includes(rel.split(/[\\/]/)[0]))
  erreur(`dataDir (ou dossierDonnees) (${DONNEES}) est dans le dépôt hors de data/ ou donnees/ : les données pourraient être publiées. Choisir un dossier hors du dépôt, ou data/ (donnees/ aussi accepté).`);
// Paquet installé : rien n'est écrit dans son dossier, même donnees/ (une mise à jour l'effacerait)
if (MODE === 'paquet' && (dansCode(BASE) || dansCode(DONNEES)))
  throw new Error(`conso-tokens : ${dansCode(BASE) ? `CONSO_TOKENS_DIR (${BASE})` : `dataDir (ou dossierDonnees) (${DONNEES})`} est dans le dossier du paquet installé (${ici}) : une mise à jour l'effacerait. Choisir un autre dossier.`);
try { mkdirSync(DONNEES, { recursive: true }); } catch (e) { erreur(`dossier des données impossible à créer : ${DONNEES} (${e.code})`); }

// Nom d'un dossier de travail à partir de la clé des journaux (ex. « C--Users-moi-Documents-Code-projet »).
// motifProjet : expression régulière dont le groupe 1 est le nom ; sans motif (ou s'il ne correspond pas), la clé sans le
// préfixe du dossier personnel. renommer : [[expression, nom affiché], …] testés d'abord (ex. masquer un dossier sensible).
const motif = c.motifProjet === undefined ? null : regex('motifProjet', c.motifProjet);
if (c.renommerProjets !== undefined && !Array.isArray(c.renommerProjets)) erreur('« renommerProjets » doit être une liste [[expression, nom], …]');
const renommer = (c.renommerProjets ?? []).map((p, i) => {
  if (!Array.isArray(p) || p.length !== 2) erreur(`renommerProjets[${i}] doit être une paire [expression, nom]`);
  return [regex(`renommerProjets[${i}]`, p[0]), texte(`renommerProjets[${i}]`, p[1])];
});
const maison = homedir().replace(/[^A-Za-z0-9]/g, '-') + '-';
export function nomProjet(cle) {
  for (const [re, nom] of renommer) if (re.test(cle)) return nom;
  const sans = cle.replace(/--claude-worktrees.*$/i, '');
  const m = motif && sans.match(motif)?.[1];
  if (m) return m;
  // Par défaut : clé sans le préfixe du dossier personnel (« C--Users-moi-Documents-x » → « Documents-x »)
  return sans.toLowerCase().startsWith(maison.toLowerCase()) ? sans.slice(maison.length) || sans : sans;
}

// Remise à zéro hebdo (jour et heure UTC) : clé remiseAZero, défaut dimanche 10:00 UTC. Seul endroit qui lit cette clé
let cycle;
try { cycle = lireCycle(c.remiseAZero); } catch (e) { erreur(`remiseAZero ${e.message}`); }
export const REMISE_A_ZERO = cycle;
// Resets de la limite hebdo, deux formes (validation dans reglages.mjs) :
//  - ancienne { "AAAA-MM-JJ (premier jour de la semaine)": "quand" } → RESETS (semaine entière perdue, comme avant) ;
//  - nouvelle [{ "quand": "AAAA-MM-JJTHH:MMZ", "type": "hebdo", "note": "…" }] → RESETS_PRECIS (la semaine est découpée).
let resets;
try { resets = lireResets(c.resets ?? undefined, fabriquer(REMISE_A_ZERO).debutSemaine); } catch (e) { erreur(`resets ${e.message}`); }
export const RESETS = resets.semaines;
export const RESETS_PRECIS = resets.precis;
// Forfaits déclarés à la main (clé forfaits, 15/11) : [{ date, semaine, forfait, changement }] triée par date (validation dans reglages.mjs)
let forfaits;
try { forfaits = lireForfaits(c.forfaits, REMISE_A_ZERO, fabriquer(REMISE_A_ZERO).debutSemaine); } catch (e) { erreur(`forfaits ${e.message}`); }
export const FORFAITS = forfaits;
// Cache des reconstructions (clé cache, 24/11) : { principal, sousAgent }, chacun { ttl, ecritureMin } (validation dans reglages.mjs)
let cache;
try { cache = lireCache(c.cache); } catch (e) { erreur(`cache ${e.message}`); }
export const CACHE = cache;
// Périodes où l'on SAIT que les journaux manquent : [[premier jour, dernier jour, raison], …] (bande orange sur la page)
export const TROUS = c.trous ?? [];
if (!Array.isArray(TROUS) || TROUS.some(t => !Array.isArray(t) || t.length !== 3)) erreur('« trous » doit être une liste [[début, fin, raison], …]');
