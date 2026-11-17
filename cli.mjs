#!/usr/bin/env node
// Commande « conso-tokens » (issue #19) : lance les scripts du dossier du code, depuis n'importe quel dossier courant.
// Chaque sous-commande est un processus Node à part (mêmes options que « node script.mjs ») ; son code de retour est rendu.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = nom => fileURLToPath(new URL(`./${nom}`, import.meta.url));
const SCRIPTS = { agreger: 'agreger.mjs', exporter: 'exporter.mjs', tarifs: 'maj-tarifs.mjs' };
const AIDE = `conso-tokens : coût de l'usage de Claude Code, d'après les journaux de ce PC

  conso-tokens maj [--journaux <dossier>] agreger puis exporter (exporter n'est pas lancé si agreger échoue)
  conso-tokens agreger [options]         journaux → donnees.json (--journaux <dossier>, --sortie <fichier>, …)
  conso-tokens exporter                  donnees.json → export/ (tables du tableau de bord) + ligne CONTRÔLES
  conso-tokens tarifs [--page fichier]   met à jour les tarifs depuis la page Pricing officielle
  conso-tokens page                      chemin de la page du tableau de bord et du dossier export/
  conso-tokens --version

Réglages et données : dans le dossier du code pour un clone, sinon dans ~/.conso-tokens ; la variable
CONSO_TOKENS_DIR (chemin absolu ou ~/…) remplace ce dossier. Détails : README.`;

const lancer = (nom, args) => {
  const r = spawnSync(process.execPath, [script(nom), ...args], { stdio: 'inherit' });
  if (r.error) { console.error(`conso-tokens : lancement de ${nom} impossible (${r.error.message})`); return 1; }
  return r.status ?? 1; // tué par un signal : échec
};

const [cmd, ...args] = process.argv.slice(2);
if (Object.hasOwn(SCRIPTS, cmd ?? '')) process.exitCode = lancer(SCRIPTS[cmd], args);
else if (cmd === 'maj') {
  // exporter lit toujours donnees.json du dossier des données : un --sortie ailleurs lui ferait exporter l'ancien
  if (args.includes('--sortie')) { console.error('conso-tokens maj : --sortie refusé (exporter lirait l\'ancien donnees.json) ; utiliser conso-tokens agreger --sortie'); process.exitCode = 2; }
  else { const code = lancer('agreger.mjs', args); process.exitCode = code !== 0 ? code : lancer('exporter.mjs', []); }
} else if (cmd === 'page') {
  const { DONNEES } = await import('./config.mjs');
  console.log(`Page du tableau de bord : ${script('page/index.html')}`);
  console.log(`Tables à charger        : ${join(DONNEES, 'export')}`);
} else if (cmd === '--version' || cmd === '-v') {
  console.log(JSON.parse(readFileSync(script('package.json'), 'utf8')).version);
} else if (cmd === undefined || cmd === 'aide' || cmd === '--help' || cmd === '-h') console.log(AIDE);
else { console.error(`conso-tokens : commande inconnue « ${cmd} »\n\n${AIDE}`); process.exitCode = 2; }
