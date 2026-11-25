# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Local dashboard of Claude Code usage: API-price cost of the logs, per plan week / day / folder / model / session, plus an
estimate of the weekly plan cap in dollars. **Code, comments, CLI output and commit messages are in French**: keep them so.
What the user types or stores has English names (options, files, config keys, `cli.mjs` commands); the old French names
are still accepted, and giving both forms of one name is an error.

## Commands

Node.js 20+, plain ES modules (`.mjs`), no dependency, no build or lint step. `package.json` only publishes the npm
package (the `conso-tokens` command is `cli.mjs`: `update`, `aggregate`, `export`, `prices`, `page`, `help`).

```
node agreger.mjs                 # logs → <data>/donnees.json (+ archive-appels.json)
node exporter.mjs                # donnees.json → <data>/export/*.json (14 tables + _tables.json), then CONTRÔLES / DÉPÔT lines
node --test                      # all tests (lib/*.test.mjs and the root ones)
node --test lib/semaine.test.mjs # one file
node --test --test-name-pattern "lireResets" lib/reglages.test.mjs   # one test
node maj-tarifs.mjs              # rewrite tarifs.json from the official Pricing page (refuses on any doubt)
node comparer-ccusage.mjs        # optional, clone only (not in `files`): per-day tokens vs pinned ccusage (npx, network)
```

`agreger.mjs` options: `--logs <projects dir>` (repeatable, logs from another PC), `--output <file>`,
`--quota-log <sonar quota-log.jsonl>` (old names `--journaux`, `--sortie`, `--journal-quota`).

`<data>` is `data/` (git-ignored; an existing `donnees/` is still used) or `dataDir` from `config.local.json`
(git-ignored; template `config.exemple.json`). For the installed npm package, the base folder is `~/.conso-tokens/`
instead; `CONSO_TOKENS_DIR` replaces it in both cases.

Simulated data, in a copy of the repo without `config.local.json`:
`node demo/generer-demo.mjs ../demo-home && HOME=../demo-home node agreger.mjs && HOME=../demo-home node exporter.mjs`.

## Pipeline

1. **`agreger.mjs`** reads `~/.claude/projects/**/*.jsonl` (and on Windows, Cowork local sessions for history). It reads
   only `usage` / `model` / `timestamp` / path fields, **never conversation content** (only exception: the rate-limit
   banner of `<synthetic>` messages, to get the reset time): keep it that way. It merges in the
   counter archive (Claude Code deletes old logs; the archive keeps every answer already counted), the sonar quota log
   (`~/.claude/sonar/quota-log.jsonl`), `rate_limit_event` lines, and manual `readings.json` (or `releves.json`). Costs
   use `tarifs.json` (built-in `INTEGRES` / `PALIERS_INTEGRES` are only a fallback). Options and file names are checked
   before anything is written. An unreadable archive stops the run: it must never be overwritten with less; it is
   written to a temp file and then renamed.
2. **`exporter.mjs`** turns `donnees.json` into the dashboard tables: off-PC usage detection (`HORS`), slopes, weekly caps,
   reset segments, plan-change weeks. Tables hold **codes and numbers, never sentences** (e.g. `etat: 'projete'`,
   `type: 'cacheRead'`). It uses one `maintenant` for the whole run. At the end it prints `rapport(controler(...))`
   (`CONTRÔLES : OK` or a list) and, in a clone, a `DÉPÔT` line if the git working tree changed: a data update must not
   change anything in the repo.
3. **`page/index.html`** is the page of a **claude.ai Dashboard artifact**, not a standalone page. It uses the platform's
   `dash.data(name)` / `dash.draw` / `dash.onData`, and opening it in a browser shows nothing. Each table in `export/` is
   one dataset with the same name. Its `<script id="libelles">` block turns the codes into sentences in French or
   English (FR / EN buttons; to add a language, see "Adding a language" in `README.md`).

## Module boundaries

The scripts at the root (`agreger`, `exporter`, `maj-tarifs`, `comparer-ccusage`, `cli`) only parse options, read and
write files, and print. Everything else is in `lib/`; only `config`, `tarifs`, `lecture` and `depot` touch the disk or
run a process. A new module must also be added to `files` in `package.json`, or the npm package breaks.

- `config.mjs` is the only reader of `config.local.json`. It maps English keys to the old names (`nomsAnciens`), adds the
  `config.local.json : …` prefix to errors and exports `DONNEES`, `REMISE_A_ZERO`, `RESETS`, `RESETS_PRECIS`,
  `FORFAITS`, `TROUS`, `nomProjet`, plus `ici` (the package root, not `lib/`), `MODE` (`clone` or `paquet`), `BASE` and
  the two `tarifs.json` paths.
- `reglages.mjs` holds the pure validators (`lireCycle`, `lireResets`, `lireForfaits`, `choisirBase`,
  `choisirDossierDonnees`, `nomsAnciens`): it imports nothing and reads no file. This is the canonical API; `semaine.mjs`
  re-exports `lireCycle` / `CYCLE_DEFAUT` for older imports.
- `semaine.mjs` is the only module that computes plan-week dates (`fabriquer(cycle)` → `debutSemaine`, `instantDebut`).
  The weekly cycle is in UTC (default Sunday 10:00), while calendar days are always Europe/Paris.
- `temps.mjs`: durations (`JOUR_MS`, `SEMAINE_MS`…), `jourParis`, `parisVersUtc`. Use it instead of writing `864e5` or a
  new Paris-date formatter.
- `tarifs.mjs`: built-in prices, `chargerTarifs` (reads `tarifs.json`), `couts(appel)`.
- `lecture.mjs` is everything `agreger.mjs` reads: logs (`lireJournaux`, the only code that opens them, so the "never
  conversation content" rule lives there), archive (`lireArchive` / `ecrireArchive`), the readings file
  (`choisirFichierReleves`, `lireRelevesManuels`), the sonar log.
  `appelsDeLaLigne` (pure) turns one log line into answers: the main model's (top-level `usage`), then one per advisor
  step (`usage.iterations` of type `advisor_message`, own model, key `<id>:advisor:<n>`, as ccusage does); `message`
  steps are already in the top-level counters. At equal output, a known answer takes the counters of the line read
  but keeps its time, folder, session and sub-agent flag (a resumed session copies the original's messages); an
  advisor step follows its main answer.
- `agregats.mjs` is pure: answers, limits and readings → the fields of `donnees.json` (`agreger`). It works on copies.
- `hebdo.mjs` is pure: off-PC detection, slopes and the weekly-cap row of each week (`analyserHebdo`): an `etat` code
  plus fields (`pct`, `fourchette…`, `coupee…`, `indicatif…`, `resetNote`), the same columns in every row. It never
  modifies `donnees`.
- `tables.mjs` is pure: `donnees.json` → the 14 tables (`construireTables`), with `GROUPES` and `formatAncien`.
- `controles.mjs` is pure (no disk access, `maintenant` passed in). There are two levels: `anomalie` (a certain bug in
  agreger/exporter) and `aVerifier` (implausible but possibly true). It owns `ETATS_HEBDO` (the list of weekly states,
  same list as `ETATS` in the page) and `forfaitDe` (same rule as in the page).
- `depot.mjs`: the `DÉPÔT` lines (`etatDepot`, runs `git status`).
- `page/index.html` is bilingual (FR / EN): `#dico` holds `LANGUES` and the screen texts (`DICO`, `tr`), `#libelles` the
  sentences of the codes (`PHRASES`). The artifact platform has two traps a local browser does not show, both checked
  by `libelles.test.mjs`:
  - no backslash anywhere in a `<script>`: the platform drops them (`\'` breaks the whole page, `\d` silently becomes
    `d`). Use a typographic apostrophe and `[0-9]`.
  - each `<script>` has its own scope: what two scripts share must go on `window` (`LANGUES`, `LANGUE_PAR_DEFAUT`,
    `DICO`, `tr`, `jourSemaine` at the end of `#dico`, `libelles` in `#libelles`).

## Code style

These rules apply to new or modified code: older code may still break them (a nested ternary in `reglages.mjs`, short
names); fix it when you touch it, in a change of its own if it is more than formatting.

- Comments say **why**, not what: the reason for a rule, a trap, a source; the code already says what it does.
- **120 characters per line at most**, comments included (counted in characters, not bytes). A string literal
  (an error message, a test title) that cannot be split without changing it may stay longer. Some files not yet
  realigned still have longer lines: shorten them when you touch them.
- **One level of ternary** at most: beyond that, an `if`, a small function or a lookup table.
- **Readable names**, in French like the rest of the code (`debutSemaine`, not `ds`); short names only for a loop index
  or a one-line callback.
- **One module, one role**: see "Module boundaries" above; a new role gets its own module in `lib/`.

## Tests

- `agregats`, `hebdo` and `tables` tests are pure: small hand-written answers or readings, with expected values worked
  out by hand (e.g. 50,000 Opus 5.5 output tokens = $1). Add a case there when you change a rule.
- `libelles.test.mjs` (root) runs the page's `#libelles` block in `node:vm`: each code must give the exact sentence the
  screen showed before the codes, and each state of `ETATS_HEBDO` must have one.
- `semaine`, `reglages` and `maj-tarifs` tests are pure. `maj-tarifs.test.mjs` breaks a saved copy of the Pricing page
  (`tests-pricing-20261113.md`) in one way per test.
- `lib/controles.test.mjs` runs on **your real exported data** (`<data>/donnees.json` + `export/`) and breaks one thing
  per test. Without data every test is skipped, and a test needing more history than you have is skipped, not failed.
  Run `agreger` and then `exporter` first; `CONSO_TOKENS_DIR=<folder> node --test` points it at other data (e.g. demo).

## Cross-file changes

- New model or price: run `node maj-tarifs.mjs`. To give the model its own chart series, add it to `GROUPES` in
  `lib/tables.mjs`; unknown models already get an automatic series key that the page displays. Fable and Mythos stay
  out of `GROUPES` on purpose: one series per version.
- New or renamed table: update `lib/tables.mjs`, the page, `lib/controles.mjs` if it is checked, and the table count/list
  in **both** `README.md` and `README.fr.md`. The two READMEs are kept in sync.
- New weekly state or field: `lib/hebdo.mjs`, `ETATS_HEBDO` in `lib/controles.mjs`, `ETATS` and its sentence in each
  language in the page's `#libelles` block, and a case in `libelles.test.mjs`.
- New `config.local.json` key: add the validator in `lib/reglages.mjs`, read it in `lib/config.mjs`, add an example to
  `config.exemple.json` and a row to both READMEs.
- New module in `lib/`: add it to `files` in `package.json`.
