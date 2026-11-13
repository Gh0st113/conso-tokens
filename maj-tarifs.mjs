// Génère tarifs.json depuis la page Pricing officielle (13/11) : node maj-tarifs.mjs [--page fichier.md]
// À lancer à la main quand un modèle sort ou change de prix ; agreger.mjs lit ensuite tarifs.json (pas de réseau à chaque mise à jour).
// Lit le tableau de la section « Model pricing », colonnes repérées par leur en-tête (pas par position).
// Écrit [entrée, sortie, lecture cache] par modèle (même forme que TARIFS d'agreger.mjs) et les paliers « prompts over N tokens ».
// Au moindre doute (colonne inconnue, prix illisible, doublon, palier non reconnu, écriture cache hors 1,25 × / 2 ×,
// que calcule agreger.mjs) : erreur, code de retour 1, et l'ancien tarifs.json reste en place (relu par DeepSeek le 13/11).
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_PAGE = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const COLONNES = { entree: /^base input/i, ec5: /^5m cache write/i, ec1: /^1h cache write/i, lecture: /^cache hits/i, sortie: /^output/i };

const nettoyer = c => c.replace(/<sup>.*?<\/sup>/gi, '').replace(/<[^>]*>/g, '').replace(/\*\*/g, '').trim();
export function lireTarifs(md) {
  const debut = md.indexOf('## Model pricing');
  if (debut < 0) throw new Error('section « Model pricing » introuvable');
  const fin = md.indexOf('\n## ', debut + 5);
  const lignes = md.slice(debut, fin < 0 ? undefined : fin).split('\n').map(l => l.trim()).filter(l => l.startsWith('|'));
  const cellules = l => l.replace(/^\||\|$/g, '').split('|').map(nettoyer);
  if (lignes.length < 3) throw new Error('tableau « Model pricing » introuvable');
  // En-tête : 1re colonne = modèle, puis chaque colonne attendue exactement une fois
  const tete = cellules(lignes[0]), pos = {};
  if (!/^model$/i.test(tete[0])) throw new Error(`1re colonne « ${tete[0]} » au lieu de « Model »`);
  tete.slice(1).forEach((t, i) => {
    const k = Object.keys(COLONNES).find(k => COLONNES[k].test(t));
    if (!k) throw new Error(`colonne inconnue : « ${t} »`);
    if (k in pos) throw new Error(`colonne en double : « ${t} »`);
    pos[k] = i + 1;
  });
  for (const k of Object.keys(COLONNES)) if (!(k in pos)) throw new Error(`colonne manquante : ${k}`);
  const prix = c => { const m = c.match(/^\$\s*([\d.]+)\s*\/\s*MTok/i); return m ? Number(m[1]) : NaN; };
  const tarifs = {}, paliers = {}, bases = new Set();
  for (const l of lignes.slice(2)) { // ligne 1 = séparateur « :--- »
    const cols = cellules(l);
    if (cols.length !== tete.length) throw new Error(`ligne à ${cols.length} colonnes au lieu de ${tete.length} : ${cols[0]}`);
    const p = Object.fromEntries(Object.entries(pos).map(([k, i]) => [k, prix(cols[i])]));
    if (!Object.values(p).every(v => Number.isFinite(v) && v >= 0)) throw new Error(`prix illisible : ${cols[0]}`);
    if (Math.abs(p.ec5 - 1.25 * p.entree) > 1e-9 || Math.abs(p.ec1 - 2 * p.entree) > 1e-9)
      throw new Error(`${cols[0]} : écriture cache ${p.ec5} / ${p.ec1} ≠ 1,25 × / 2 × l'entrée ${p.entree} (agreger.mjs ne sait pas la calculer)`);
    // « Claude Haiku 5.5 (for prompts over 100,000 tokens) » → palier ; « (retired…) », « ([limited…]) » → retirés du nom
    const nom = cols[0].replace(/^Claude\s+/, '').replace(/\s*\(.*$/, '').trim();
    if (!/^[A-Z][a-z]+ \d+(\.\d+)?$/.test(nom)) throw new Error(`nom de modèle inattendu : « ${cols[0]} »`);
    const parenth = cols[0].match(/\(([^)]*prompts?[^)]*)\)/i)?.[1];
    const tarif = [p.entree, p.sortie, p.lecture];
    if (parenth && /\bover\b/i.test(parenth)) {
      const s = parenth.match(/over ([\d,]+) tokens/i);
      if (!s) throw new Error(`palier non reconnu : « ${cols[0]} »`);
      if (paliers[nom]) throw new Error(`deux paliers pour ${nom}`);
      paliers[nom] = { seuil: Number(s[1].replaceAll(',', '')), tarif };
    } else if (parenth && !/\bup to\b/i.test(parenth)) throw new Error(`mention de prompts non reconnue : « ${cols[0]} »`);
    else {
      if (bases.has(nom)) throw new Error(`modèle en double : ${nom}`);
      bases.add(nom); tarifs[nom] = tarif;
    }
  }
  for (const m of Object.keys(paliers)) if (!tarifs[m]) throw new Error(`palier sans tarif de base : ${m}`);
  if (Object.keys(tarifs).length < 5) throw new Error(`seulement ${Object.keys(tarifs).length} modèles lus : forme de la page changée ?`);
  return { tarifs, paliers };
}

// Lancé directement (pas importé par un test)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ici = dirname(fileURLToPath(import.meta.url)), sortie = join(ici, 'tarifs.json');
  const iPage = process.argv.indexOf('--page');
  const texte = iPage > 0 ? readFileSync(process.argv[iPage + 1], 'utf8') : await (async () => {
    const r = await fetch(URL_PAGE);
    if (!r.ok) throw new Error(`page Pricing : HTTP ${r.status}`);
    return r.text();
  })();
  const { tarifs, paliers } = lireTarifs(texte);
  // Modèle retiré de la page : son ancien tarif est GARDÉ (sinon son historique tomberait à 0 $), et signalé
  let avant = {};
  try { avant = JSON.parse(readFileSync(sortie, 'utf8')).tarifs ?? {}; } catch {}
  const partis = Object.keys(avant).filter(m => !tarifs[m]);
  for (const m of partis) tarifs[m] = avant[m];
  writeFileSync(sortie + '.tmp', JSON.stringify({ source: URL_PAGE, luLe: new Date().toISOString(), tarifs, paliers }, null, 1));
  renameSync(sortie + '.tmp', sortie);
  console.log(`${Object.keys(tarifs).length} modèles, ${Object.keys(paliers).length} palier(s) -> ${sortie}`);
  console.log(Object.entries(tarifs).map(([m, [e, s, l]]) => `  ${m} : ${e} / ${s} / ${l}`).join('\n'));
  if (partis.length) console.log(`Info : absents de la page, ancien tarif gardé : ${partis.join(', ')}`);
}
