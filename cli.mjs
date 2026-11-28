#!/usr/bin/env node
// Commande « conso-tokens » (issue #19) : lance les scripts du dossier du code, depuis n'importe quel dossier courant.
// Chaque sous-commande est un processus Node à part (mêmes options que « node script.mjs ») ; son code de retour est rendu.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = nom => fileURLToPath(new URL(`./${nom}`, import.meta.url));
const SCRIPTS = { agreger: 'agreger.mjs', exporter: 'exporter.mjs', tarifs: 'maj-tarifs.mjs' };
// Noms anglais (lot 1, 17/11) → noms français, qui restent acceptés
const NOM_ANGLAIS = { update: 'maj', aggregate: 'agreger', export: 'exporter', prices: 'tarifs', help: 'aide', '--help': 'aide', '-h': 'aide' };
// Aide en français, comme toutes les autres sorties de console (issue #54)
const AIDE = `conso-tokens : coût de l'usage de Claude Code, d'après les journaux de ce PC

  conso-tokens update [--logs <dossier>]   agrège, puis exporte (pas d'export si l'agrégation échoue)
  conso-tokens aggregate [options]         journaux → donnees.json (--logs <dossier>, --output <fichier>, …)
  conso-tokens export                      donnees.json → export/ (tables du tableau de bord) + la ligne CONTRÔLES
  conso-tokens prices [--page <fichier>]   met à jour les tarifs depuis la page Pricing officielle
  conso-tokens page                        chemin de la page du tableau de bord et du dossier export/
  conso-tokens --version
  conso-tokens help                        ce texte (sans argument : pareil)

Réglages et données : dans le dossier du code pour un clone, sinon dans ~/.conso-tokens ; la variable
d'environnement CONSO_TOKENS_DIR (chemin absolu ou ~/…) remplace ce dossier. Détails : README.
Les noms français des commandes (maj, agreger, exporter, tarifs, aide) sont aussi acceptés, de même que
les noms français des options (--journaux pour --logs, --sortie pour --output, --journal-quota pour
--quota-log).`;

const lancer = (nom, args) => {
  const r = spawnSync(process.execPath, [script(nom), ...args], { stdio: 'inherit' });
  if (r.error) { console.error(`conso-tokens : lancement de ${nom} impossible (${r.error.message})`); return 1; }
  return r.status ?? 1; // tué par un signal : échec
};

const [cmdSaisi, ...args] = process.argv.slice(2);
const cmd = Object.hasOwn(NOM_ANGLAIS, cmdSaisi ?? '') ? NOM_ANGLAIS[cmdSaisi] : cmdSaisi;
if (Object.hasOwn(SCRIPTS, cmd ?? '')) process.exitCode = lancer(SCRIPTS[cmd], args);
else if (cmd === 'maj') {
  // exporter lit toujours donnees.json du dossier des données : un --sortie (ou --output) ailleurs lui ferait exporter l'ancien
  if (args.includes('--sortie') || args.includes('--output')) { console.error('conso-tokens update : --output refusé (exporter lirait l\'ancien donnees.json) ; utiliser conso-tokens aggregate --output (ou --sortie)'); process.exitCode = 2; }
  else { const code = lancer('agreger.mjs', args); process.exitCode = code !== 0 ? code : lancer('exporter.mjs', []); }
} else if (cmd === 'page') {
  const { DONNEES } = await import('./lib/config.mjs');
  console.log(`Page du tableau de bord : ${script('page/index.html')}`);
  console.log(`Tables à charger        : ${join(DONNEES, 'export')}`);
} else if (cmd === '--version' || cmd === '-v') {
  console.log(JSON.parse(readFileSync(script('package.json'), 'utf8')).version);
} else if (cmd === undefined || cmd === 'aide') console.log(AIDE);
else { console.error(`conso-tokens : commande inconnue « ${cmd} »\n\n${AIDE}`); process.exitCode = 2; }
