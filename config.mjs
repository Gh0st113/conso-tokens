// Réglages propres à chaque utilisateur : config.local.json à côté des scripts (ignoré par git ; modèle : config.exemple.json).
// Sans ce fichier, tout marche avec les valeurs par défaut ci-dessous.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ici = dirname(fileURLToPath(import.meta.url));
const erreur = m => { throw new Error(`config.local.json : ${m}`); };
let c = {};
try { c = JSON.parse(readFileSync(join(ici, 'config.local.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') erreur(`illisible (${e.message})`); }
if (c === null || typeof c !== 'object' || Array.isArray(c)) erreur('doit contenir un objet { … }');
const texte = (k, v) => { if (typeof v !== 'string' || !v) erreur(`« ${k} » doit être un texte non vide`); return v; };
const regex = (k, v) => { try { return new RegExp(texte(k, v), 'i'); } catch (e) { erreur(`« ${k} » n'est pas une expression régulière valide (${e.message})`); } };
// « ~ » seul ou « ~/… » = dossier personnel ; « ~autre » refusé (sens ambigu)
const chemin = (k, p) => {
  texte(k, p);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(1));
  if (p.startsWith('~')) erreur(`« ${k} » : seuls « ~ » et « ~/… » sont acceptés`);
  return resolve(ici, p);
};

// Dossier des données (donnees.json, archive-appels.json, releves.json, export/) : hors du dépôt de préférence
export const DONNEES = c.dossierDonnees === undefined ? join(ici, 'donnees') : chemin('dossierDonnees', c.dossierDonnees);
// Garde-fou : dans le dépôt, les données ne vont QUE dans donnees/ (ignoré par git) ; ailleurs dans le dépôt, elles
// pourraient être commitées et publiées → refus
const rel = relative(ici, DONNEES);
const horsDepot = isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../');
if (!horsDepot && rel.split(/[\\/]/)[0] !== 'donnees')
  erreur(`dossierDonnees (${DONNEES}) est dans le dépôt hors de donnees/ : les données pourraient être publiées. Choisir un dossier hors du dépôt ou donnees/.`);
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

// Resets de la limite hebdo donnés à la main : { "AAAA-MM-JJ (dimanche de la semaine)": "quand" }
export const RESETS = c.resets ?? {};
// Périodes où l'on SAIT que les journaux manquent : [[premier jour, dernier jour, raison], …] (bande orange sur la page)
export const TROUS = c.trous ?? [];
if (typeof RESETS !== 'object' || Array.isArray(RESETS)) erreur('« resets » doit être un objet { "AAAA-MM-JJ": "quand" }');
if (!Array.isArray(TROUS) || TROUS.some(t => !Array.isArray(t) || t.length !== 3)) erreur('« trous » doit être une liste [[début, fin, raison], …]');
