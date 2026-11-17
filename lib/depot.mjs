// Garde-fou de publication : une mise à jour des données ne doit RIEN changer dans le dépôt. Un fichier modifié,
// nouveau ou supprimé (hors fichiers ignorés) donne une ligne « DÉPÔT », à citer telle quelle ; aucune ligne si tout
// est propre. Ne regarde que le dépôt, pas un dossier de données placé ailleurs.
import { execFileSync } from 'node:child_process';

// Lignes « DÉPÔT : … » à afficher pour le dépôt qui contient dossier (aucune si tout est propre)
export function etatDepot(dossier) {
  const git = (...args) => execFileSync('git', ['-C', dossier, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 2 ** 20 });
  const premiereLigne = e => String(e.stderr || e.message).trim().split(/\r?\n/)[0];
  try {
    if (git('rev-parse', '--is-inside-work-tree').trim() !== 'true') return [];
  } catch (e) {
    // Copie sans .git, ou git absent : rien à vérifier ; tout autre échec est signalé
    if (e.code === 'ENOENT' || /not a git repository/i.test(String(e.stderr))) return [];
    return [`DÉPÔT : contrôle impossible (${premiereLigne(e)})`];
  }
  try {
    git('rev-parse', '--verify', '--quiet', 'HEAD');
  } catch {
    return ['DÉPÔT : aucun commit encore, contrôle impossible'];
  }
  try {
    // -uall : chaque fichier non suivi est listé, même si status.showUntrackedFiles=no est réglé
    const lignes = git('status', '--porcelain', '-uall').split(/\r?\n/).filter(Boolean);
    if (!lignes.length) return [];
    const etat = xy => {
      if (xy === '??') return 'nouveau';
      return xy.includes('D') ? 'supprimé' : 'modifié';
    };
    const fichiers = lignes.map(l => `${l.slice(3)} (${etat(l.slice(0, 2))})`).join(', ');
    return [`DÉPÔT : ${lignes.length} fichier(s) modifié(s), nouveau(x) ou supprimé(s), `
      + `ne rien commiter sans relecture : ${fichiers}`];
  } catch (e) {
    return [`DÉPÔT : contrôle impossible (${premiereLigne(e)})`];
  }
}
