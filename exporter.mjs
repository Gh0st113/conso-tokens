// Transforme donnees.json (sortie d'agreger.mjs) en tables JSON pour le tableau de bord (dossier export/), puis
// affiche la ligne CONTRÔLES et, pour un clone, une ligne DÉPÔT si le dépôt a changé.
// Usage : node exporter.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DONNEES, RESETS, RESETS_PRECIS, FORFAITS, TROUS, REMISE_A_ZERO, OBJECTIF_CONTEXTE, ici, MODE }
  from './lib/config.mjs';
import { fabriquer } from './lib/semaine.mjs';
import { construireTables, formatAncien } from './lib/tables.mjs';
import { controler, rapport } from './lib/controles.mjs';
import { etatDepot } from './lib/depot.mjs';

function main() {
  const donnees = JSON.parse(readFileSync(join(DONNEES, 'donnees.json'), 'utf8'));
  const sortie = join(DONNEES, 'export');
  mkdirSync(sortie, { recursive: true });
  // Un seul « maintenant » pour l'export et ses contrôles : sinon, autour de la remise à zéro hebdo, ils pourraient
  // voir deux semaines différentes
  const maintenant = Date.now();
  if (formatAncien(donnees)) {
    console.error('ERREUR : donnees.json vient d\'une ancienne version d\'agreger.mjs (champs par jour, '
      + 'jour des sessions ou segments de reset absents) : relancer node agreger.mjs');
    process.exit(1);
  }

  const { tables, series, inconnus } = construireTables(donnees, {
    cycle: REMISE_A_ZERO, resets: RESETS, resetsPrecis: RESETS_PRECIS, forfaits: FORFAITS, trous: TROUS, maintenant,
    objectifContexte: OBJECTIF_CONTEXTE,
  });
  for (const [nom, rows] of Object.entries(tables)) writeFileSync(join(sortie, `${nom}.json`), JSON.stringify(rows));
  // Manifeste : noms des tables écrites à ce passage, triés ; la procédure de mise à jour s'en sert pour les pousser
  writeFileSync(join(sortie, '_tables.json'), JSON.stringify(Object.keys(tables).sort()));
  console.log(Object.entries(tables).map(([nom, rows]) => `${nom}: ${rows.length}`).join(', '), '->', sortie);
  if (inconnus.length) {
    console.log(`Info : modèle(s) hors de GROUPES, chacun en série à part sur la page : ${inconnus.join(', ')}`);
  }

  // Les contrôles n'empêchent pas l'export (code de retour 0) ; la ligne « CONTRÔLES : … » est à citer telle quelle
  const { debutSemaine } = fabriquer(REMISE_A_ZERO);
  console.log(rapport(controler(donnees, tables, { maintenant, groupes: series, debutSemaine })));
  // Paquet installé : pas de dépôt à protéger, et git -C remonterait au dépôt d'un projet hôte
  if (MODE === 'clone') for (const ligne of etatDepot(ici)) console.log(ligne);
}

main();
