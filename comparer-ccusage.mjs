// Contrôle croisé avec ccusage (17/11) : compare, jour par jour (heure de Paris), les jetons de donnees.json avec ceux que
// ccusage lit dans les mêmes journaux (~/.claude/projects). N'écrit rien. Télécharge ccusage par npx (réseau) au 1er lancement.
// Usage : node comparer-ccusage.mjs   (après node agreger.mjs)
// Écart négatif (ccusage < ici) attendu : journaux effacés mais gardés dans l'archive, --journaux, Cowork local.
// Écart positif (ccusage > ici) : réponses que agreger.mjs ne compte pas → à regarder.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DONNEES } from './config.mjs';

// Version figée : une nouvelle version de ccusage ne s'exécute pas sans relecture
const CCUSAGE = 'ccusage@20.0.51';
const CHAMPS = [['entree', 'inputTokens', 'entrée'], ['sortie', 'outputTokens', 'sortie'],
  ['ecritureCache', 'cacheCreationTokens', 'écriture cache'], ['lectureCache', 'cacheReadTokens', 'lecture cache']];

// Pur : jours de ccusage (daily) comparés à parJour de donnees.json ; jours ≥ jourLimite ignorés (journaux encore écrits
// après le passage d'agreger.mjs). Un jour absent de ccusage n'est pas comparé (journaux effacés, gardés dans l'archive).
export function comparer(parJour, daily, jourLimite) {
  const ecarts = [];
  let compares = 0;
  for (const r of daily) {
    if (r.date >= jourLimite) continue;
    compares++;
    const v = parJour[r.date] ?? {};
    const diffs = CHAMPS.map(([ici, cc, nom]) => [nom, (r[cc] ?? 0) - (v[ici] ?? 0)]).filter(([, n]) => n);
    const coutIci = v.cout ?? 0, coutCc = r.totalCost ?? 0;
    if (diffs.length || Math.abs(coutCc - coutIci) > 0.01) ecarts.push({ jour: r.date, diffs, coutCc, coutIci });
  }
  return { compares, ecarts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = JSON.parse(readFileSync(join(DONNEES, 'donnees.json'), 'utf8'));
  const windows = process.platform === 'win32';
  let brut;
  try {
    // Arguments fixes (aucune entrée utilisateur) : le shell, nécessaire pour npx.cmd sous Windows, ne reçoit rien d'autre
    brut = execFileSync(windows ? 'npx.cmd' : 'npx', ['-y', CCUSAGE, 'claude', 'daily', '--json', '--timezone', 'Europe/Paris', '--offline'], {
      encoding: 'utf8', maxBuffer: 64 * 2 ** 20, stdio: ['ignore', 'pipe', 'pipe'], shell: windows,
      // Même dossier que agreger.mjs (sans ça, ccusage lit aussi ~/.config/claude)
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(homedir(), '.claude') },
    });
  } catch (e) {
    console.log(`CCUSAGE : lancement impossible (${String(e.stderr || e.message).trim().split(/\r?\n/)[0]})`);
    process.exit(1);
  }
  let daily;
  try { daily = JSON.parse(brut).daily; } catch { daily = null; }
  if (!Array.isArray(daily)) { console.log('CCUSAGE : sortie inattendue (pas de liste « daily »), rien comparé'); process.exit(1); }

  const jourLimite = new Date(d.genereLe).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const { compares, ecarts } = comparer(d.parJour, daily, jourLimite);
  const nb = n => (n > 0 ? '+' : '') + n.toLocaleString('fr-FR');
  const usd = n => n.toFixed(2).replace('.', ',') + ' $';
  if (!ecarts.length) console.log(`CCUSAGE : OK (${compares} jours comparés, avant le ${jourLimite})`);
  else {
    console.log(`CCUSAGE : ${ecarts.length} jour(s) sur ${compares} diffèrent (ccusage − ici, jours avant le ${jourLimite}) :`);
    for (const e of ecarts) console.log(`  ${e.jour} : ${e.diffs.map(([nom, n]) => `${nom} ${nb(n)}`).join(', ') || 'mêmes jetons'} ; coût ccusage ${usd(e.coutCc)}, ici ${usd(e.coutIci)}`);
    console.log('  Écart négatif : journaux effacés gardés dans l\'archive, --journaux ou Cowork local. Écart positif : réponses non comptées par agreger.mjs.');
  }
}
