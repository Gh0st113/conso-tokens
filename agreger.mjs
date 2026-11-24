// Agrège les compteurs de jetons des journaux Claude Code (~/.claude/projects/**/*.jsonl) dans donnees.json.
// Usage : node agreger.mjs [--output fichier.json] [--logs dossier]... [--quota-log quota-log.jsonl]
//   --output (ancien nom : --sortie) : défaut donnees.json dans le dossier des données (lib/config.mjs)
//   --logs (ancien nom : --journaux) : dossier « projects » de plus, au format Claude Code (ex. copie venue d'un autre
//     PC), répétable
//   --quota-log (ancien nom : --journal-quota) : journal du mod sonar ailleurs qu'à ~/.claude/sonar/quota-log.jsonl
//     (son option quotaLogPath)
// L'archive (archive-appels.json, dans le dossier des données) garde les compteurs de chaque réponse déjà vue : Claude
// Code efface les journaux non modifiés depuis cleanupPeriodDays jours (30 par défaut).
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  DONNEES, BASE, MODE, TARIFS_ECRITS, TARIFS_LIVRES, REMISE_A_ZERO, RESETS, RESETS_PRECIS, nomProjet,
} from './lib/config.mjs';
import { chargerTarifs } from './lib/tarifs.mjs';
import {
  racinesCowork, lister, lireArchive, ecrireArchive, lireJournaux, choisirFichierReleves, lireRelevesManuels,
  relevesDeLAppli, lireSonar,
} from './lib/lecture.mjs';
import { agreger } from './lib/agregats.mjs';

// Valeur qui suit l'option (nom anglais, ou son ancien nom français), defaut si elle est absente. Les deux noms
// ensemble : erreur.
function valeurDe(argv, [nouveau, ancien], defaut) {
  const n = argv.indexOf(nouveau), a = argv.indexOf(ancien);
  if (n > 0 && a > 0) throw new Error(`${nouveau} et ${ancien} : deux noms de la même option, n'en garder qu'un`);
  const i = Math.max(n, a);
  return i > 0 ? argv[i + 1] : defaut;
}
// Dossiers --logs (ou --journaux), chacun vérifié ; sans doublon, ni le dossier par défaut (déjà lu)
function dossiersEnPlus(argv, racine) {
  const dossiers = argv.flatMap((v, i) => {
    if (v !== '--logs' && v !== '--journaux') return [];
    const r = argv[i + 1];
    if (!r || r.startsWith('--')) throw new Error(`${v} : il manque le dossier`);
    if (!statSync(r, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${v} : dossier introuvable : ${r}`);
    return [resolve(r)];
  });
  return [...new Set(dossiers)].filter(r => r !== resolve(racine));
}

async function main(argv) {
  const racine = join(homedir(), '.claude', 'projects');
  const cowork = racinesCowork(homedir());
  // Options et fichier des relevés contrôlés ici, avant toute écriture de l'archive
  const sortie = valeurDe(argv, ['--output', '--sortie'], join(DONNEES, 'donnees.json'));
  const journalQuota = valeurDe(argv, ['--quota-log', '--journal-quota'],
    join(homedir(), '.claude', 'sonar', 'quota-log.jsonl'));
  const enPlus = dossiersEnPlus(argv, racine);
  const fichierArchive = join(DONNEES, 'archive-appels.json');
  const fichierReleves = choisirFichierReleves(DONNEES);
  if (!existsSync(racine) && !enPlus.length && !cowork.length) {
    console.error(`Aucun journal Claude Code dans ${racine} : lancer d'abord une session Claude Code, `
      + 'ou indiquer --logs <dossier>.');
    process.exit(1);
  }

  const { tarifs, paliers } = chargerTarifs([TARIFS_ECRITS, TARIFS_LIVRES]);
  const archive = lireArchive(fichierArchive);
  // Paquet npm, premier passage : l'archive d'un clone éventuel n'est pas reprise d'elle-même
  if (archive.nouvelle && MODE === 'paquet') {
    console.log(`Info : nouvelle archive des compteurs créée dans ${DONNEES}. Si vous aviez un clone de conso-tokens, `
      + `copiez son config.local.json dans ${BASE} et, si ses données étaient dans son dossier data/ ou donnees/ `
      + `(défaut) ou à un chemin relatif (dataDir), copiez aussi ce dossier de données dans ${DONNEES}, et son `
      + `tarifs.json s'il a été mis à jour, AVANT le prochain passage, pour garder son historique.`);
  }
  const dejaArchives = archive.appels.size;

  const fichiers = [
    ...(existsSync(racine) ? lister(racine) : []).map(f => ({ f, racine, cowork: false })),
    ...enPlus.flatMap(r => lister(r).map(f => ({ f, racine: r, cowork: false }))),
    ...cowork.flatMap(r => lister(r).map(f => ({ f, racine: r, cowork: true }))),
  ];
  const { lignes, illisibles } = await lireJournaux(fichiers, archive, nomProjet);
  ecrireArchive(fichierArchive, archive);

  const sonar = lireSonar(journalQuota);
  const releves = [...lireRelevesManuels(fichierReleves), ...relevesDeLAppli(archive.releves), ...sonar];
  const { sansTarif, ...calcul } = agreger({
    appels: archive.appels.values(), limites: archive.limites.values(), compactages: archive.compactages.values(),
    releves, tarifs, paliers,
    cycle: REMISE_A_ZERO, resets: RESETS, resetsPrecis: RESETS_PRECIS,
  });
  writeFileSync(sortie, JSON.stringify({
    genereLe: new Date().toISOString(), lignesUsage: lignes, illisibles, reponsesUniques: archive.appels.size,
    reset: { jour: REMISE_A_ZERO.jour, heureUTC: REMISE_A_ZERO.heureUTC, fuseau: 'UTC' }, tarifs, paliers,
    ...calcul,
  }, null, 1));

  console.log(`${archive.appels.size} réponses uniques (${lignes} lignes « usage », ${illisibles} illisibles), `
    + `${calcul.sessions.length} sessions, ${sonar.length} relevés sonar -> ${sortie}`);
  console.log(`archive : ${dejaArchives} réponses déjà connues, ${archive.appels.size - dejaArchives} nouvelles `
    + `-> ${fichierArchive}`);
  if (sansTarif.length) {
    console.log(`ATTENTION : modèle(s) sans tarif, comptés à 0 $ : ${sansTarif.join(', ')} `
      + '→ relancer node maj-tarifs.mjs, sinon les ajouter à INTEGRES (lib/tarifs.mjs)');
  }
}

await main(process.argv);
