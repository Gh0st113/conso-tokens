// Données SIMULÉES pour les captures du README et pour essayer le tableau sans vrais journaux.
// Fabrique un faux dossier personnel : <dossier>/.claude/projects/<dossier de travail>/<session>.jsonl (format Claude Code)
// et <dossier>/.claude/sonar/quota-log.jsonl (format sonar). Tirage à graine fixe : même résultat à chaque lancement
// (sauf les dates, calées sur les 8 dernières semaines).
//
// Usage, dans une COPIE du dépôt sans config.local.json (sinon les résultats iraient dans votre dossier de données) :
//   node demo/generer-demo.mjs ../demo-home
//   PowerShell : $env:USERPROFILE = (Resolve-Path ../demo-home); node agreger.mjs; node exporter.mjs
//   macOS / Linux : HOME=../demo-home node agreger.mjs && HOME=../demo-home node exporter.mjs
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dest = resolve(process.argv[2] ?? 'demo-home');
if (existsSync(dest) && readdirSync(dest).length) throw new Error(`${dest} n'est pas vide : choisir un dossier neuf`);

// Générateur pseudo-aléatoire à graine fixe (mulberry32)
let graine = 20260104;
const alea = () => { graine |= 0; graine = graine + 0x6d2b79f5 | 0; let t = Math.imul(graine ^ graine >>> 15, 1 | graine);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const entre = (a, b) => a + alea() * (b - a);
const choisir = poids => { let r = alea() * poids.reduce((s, [, p]) => s + p, 0); for (const [v, p] of poids) if ((r -= p) < 0) return v; return poids[0][0]; };
const hex = n => Array.from({ length: n }, () => Math.floor(alea() * 16).toString(16)).join('');

// $/million : entrée, sortie, lecture cache (écriture cache = 1,25 × entrée)
const PRIX = { 'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-fable-5-2': [8, 40, 0.2], 'claude-opus-4-6': [5, 25, 0.5] };
const DOSSIERS = [['site-vitrine', 4], ['api-commandes', 3], ['outils-cli', 2], ['blog', 1], ['app-mobile', 2]];
const PLAFOND = 180;            // prix de 100 % de la limite hebdo, en $
const PLAFOND_5H = 45;          // prix de 100 % de la fenêtre de 5 h, en $
const SEMAINES = 8;

const reset = t => { const d = new Date(t); let recul = (d.getUTCDay() + 7) % 7; // dernier dimanche 10:00 UTC
  if (recul === 0 && d.getUTCHours() < 10) recul = 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - recul, 10); };
const maintenant = Date.now(), debut = reset(maintenant) - (SEMAINES - 1) * 7 * 864e5;
const iso = t => new Date(t).toISOString();

const journaux = {}, sonar = [];
let tPrec = 0, semaine = null, coutSemaine = 0, horsSemaine = 0, fenetre5h = 0, cout5h = 0, dernier = null, bloque = false;
const noter = t => { // relevé sonar quand un % entier change
  const r = { ts: iso(t), five_hour: { pct: Math.min(100, Math.floor(cout5h / PLAFOND_5H * 100)), resets_at: iso(fenetre5h + 5 * 36e5) },
    seven_day: { pct: Math.min(100, Math.floor((coutSemaine / PLAFOND * 100) + horsSemaine)), resets_at: iso(semaine + 7 * 864e5) } };
  const cle = `${r.five_hour.pct}/${r.seven_day.pct}`;
  if (cle !== dernier) { sonar.push(r); dernier = cle; }
};

for (let jour = debut; jour < maintenant; jour += 864e5) {
  const n = Math.floor((jour - debut) / 864e5), dansSemaine = n % 7;
  if (alea() < 0.12) continue; // jour sans usage
  const nbSessions = 1 + Math.floor(entre(0, dansSemaine < 2 ? 2 : 4));
  // Débuts triés, sessions jamais superposées : le coût cumulé suit l'ordre des heures (sinon faux sauts du %)
  const debuts = Array.from({ length: nbSessions }, () => jour + entre(0, 13) * 36e5).sort((a, b) => a - b);
  for (let s = 0; s < nbSessions; s++) {
    let t = Math.max(debuts[s], tPrec + entre(10, 90) * 6e4);
    if (t > maintenant) break;
    const projet = choisir(DOSSIERS), session = `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
    const ancien = n < 21, recent = n > 35;
    const modele = choisir([['claude-opus-5-5', 6], ['claude-sonnet-5-5', 2], ['claude-haiku-5-5', 1],
      ['claude-opus-4-6', ancien ? 2 : 0], ['claude-fable-5-2', recent ? 1.5 : 0]]);
    const lignes = (journaux[`${projet}/${session}`] ??= []);
    let contexte = entre(15e3, 40e3);
    const nbAppels = Math.floor(entre(20, 140));
    for (let a = 0; a < nbAppels && t < maintenant; a++, t += entre(20, 100) * 1e3) {
      const sem = reset(t);
      if (sem !== semaine) { semaine = sem; coutSemaine = 0; horsSemaine = 0; bloque = false; }
      if (t >= fenetre5h + 5 * 36e5) { fenetre5h = t; cout5h = 0; }
      if (bloque) break;
      // Usage hors de ce PC (claude.ai, téléphone) : quelques hausses du % sans dépense ici
      // (relevé daté juste avant la session, après plus de 2 h sans activité ici : la hausse est vue sans dépense locale)
      if (a === 0 && t - tPrec > 2 * 36e5 && alea() < 0.1) { horsSemaine += Math.floor(entre(2, 5)); noter(t - 1e3); }
      tPrec = t;
      const ecriture = Math.round(entre(1e3, 25e3)), sortie = Math.round(entre(150, 3500)), entree = Math.round(entre(3, 60));
      const [pe, ps, pl] = PRIX[modele];
      const cout = (entree * pe + ecriture * pe * 1.25 + contexte * pl + sortie * ps) / 1e6;
      lignes.push(JSON.stringify({ type: 'assistant', timestamp: iso(t), uuid: `${hex(8)}-${hex(4)}`, sessionId: session,
        message: { id: `msg_demo${hex(20)}`, model: modele, usage: { input_tokens: entree, cache_creation_input_tokens: ecriture,
          cache_read_input_tokens: Math.round(contexte), output_tokens: sortie } } }));
      coutSemaine += cout; cout5h += cout;
      contexte = Math.min(contexte + ecriture * 0.8, entre(180e3, 320e3));
      noter(t);
      if (coutSemaine / PLAFOND * 100 + horsSemaine >= 100) { // limite hebdo atteinte : message de l'appli, plus rien jusqu'au reset
        const r = new Date(semaine + 7 * 864e5), h = r.getUTCHours() + 1; // heure de Paris en hiver
        lignes.push(JSON.stringify({ type: 'assistant', timestamp: iso(t + 1e3), uuid: `${hex(8)}-${hex(4)}`,
          message: { id: `msg_demo${hex(20)}`, model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 },
            content: [{ type: 'text', text: `You've hit your weekly limit · resets ${h % 12 || 12}${h < 12 ? 'am' : 'pm'} (Europe/Paris)` }] } }));
        bloque = true;
      }
    }
  }
}

for (const [chemin, lignes] of Object.entries(journaux)) {
  const [projet, session] = chemin.split('/');
  mkdirSync(join(dest, '.claude', 'projects', projet), { recursive: true });
  writeFileSync(join(dest, '.claude', 'projects', projet, `${session}.jsonl`), lignes.join('\n') + '\n');
}
mkdirSync(join(dest, '.claude', 'sonar'), { recursive: true });
writeFileSync(join(dest, '.claude', 'sonar', 'quota-log.jsonl'), sonar.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`${Object.keys(journaux).length} sessions simulées, ${sonar.length} relevés sonar -> ${dest}`);
