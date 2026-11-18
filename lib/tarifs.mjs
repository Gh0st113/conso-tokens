// Tarifs API ($ par million de jetons : [entrée, sortie, lecture cache]) et coût d'une réponse.
// tarifs.json (écrit par maj-tarifs.mjs depuis la page Pricing officielle) prime ; la liste intégrée ne sert que de
// repli si aucun fichier n'est lisible. Nouveau modèle : relancer node maj-tarifs.mjs (sinon coût 0 $, signalé).
// Écriture cache : 1,25 × entrée (5 min) ou 2 × entrée (1 h). Estimation : le forfait ne se facture pas ainsi.
import { readFileSync } from 'node:fs';

export const INTEGRES = {
  'Fable 5.2': [8, 40, 0.20], 'Fable 5.1': [10, 50, 0.25], 'Fable 5': [10, 50, 1],
  'Mythos 5.2': [8, 40, 0.20], 'Mythos 5.1': [10, 50, 0.25], 'Mythos 5': [10, 50, 1],
  'Opus 5.5': [4, 20, 0.20], 'Opus 4.8': [5, 25, 0.50], 'Sonnet 5.5': [2, 10, 0.10],
  'Sonnet 5': [2, 10, 0.20], 'Haiku 5.5': [0.10, 0.50, 0.01], 'Haiku 4.5': [1, 5, 0.10],
};
// « Long context pricing » : prompt (entrée + écriture cache + lecture cache) au-delà du seuil → TOUTE la requête au
// tarif haut, même la partie lue du cache (chaque requête est tarifée seule)
export const PALIERS_INTEGRES = { 'Haiku 5.5': { seuil: 100000, tarif: [0.50, 2.50, 0.05] } };

// Entrée valide = 3 nombres finis ≥ 0
const tarifValide = t => Array.isArray(t) && t.length === 3 && t.every(v => Number.isFinite(v) && v >= 0);

// Premier fichier lisible de la liste, fusionné avec les tarifs intégrés. Une entrée invalide est ignorée (le tarif
// intégré reste) et signalée.
export function chargerTarifs(fichiers) {
  let fichier = {};
  for (const f of [...new Set(fichiers)]) {
    try {
      fichier = JSON.parse(readFileSync(f, 'utf8'));
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') console.log(`ATTENTION : ${f} illisible (${e.message}) : ignoré`);
    }
  }
  const tarifs = { ...INTEGRES };
  for (const [modele, t] of Object.entries(fichier.tarifs ?? {})) {
    if (tarifValide(t)) tarifs[modele] = t;
    else console.log(`ATTENTION : tarifs.json, tarif invalide pour ${modele} : ignoré`);
  }
  // Un modèle tarifé par le fichier n'a que ses paliers à lui : un palier retiré de la page disparaît
  const paliers = Object.fromEntries(Object.entries(PALIERS_INTEGRES).filter(([m]) => !(m in (fichier.tarifs ?? {}))));
  for (const [modele, p] of Object.entries(fichier.paliers ?? {})) {
    if (Number.isFinite(p?.seuil) && p.seuil > 0 && tarifValide(p.tarif)) paliers[modele] = p;
    else console.log(`ATTENTION : tarifs.json, palier invalide pour ${modele} : ignoré`);
  }
  return { tarifs, paliers };
}

// Coût d'une réponse ($), par type de jetons et au total. Modèle sans tarif : 0 $.
export function couts(appel, { tarifs, paliers }) {
  const palier = paliers[appel.modele];
  const haut = palier && appel.entree + appel.ecritureCache + appel.lectureCache > palier.seuil;
  const [entree, sortie, lecture] = haut ? palier.tarif : tarifs[appel.modele] ?? [0, 0, 0];
  const coutEntree = appel.entree * entree / 1e6;
  const coutEcriture = (appel.ecriture5m * 1.25 + appel.ecriture1h * 2) * entree / 1e6;
  const coutLecture = appel.lectureCache * lecture / 1e6;
  const coutSortie = appel.sortie * sortie / 1e6;
  const cout = coutEntree + coutEcriture + coutLecture + coutSortie;
  return { cout, coutEntree, coutEcriture, coutLecture, coutSortie };
}
