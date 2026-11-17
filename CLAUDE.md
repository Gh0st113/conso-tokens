# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Local dashboard of Claude Code usage: API-price cost of the logs, per plan week / day / folder / model / session, plus an
estimate of the weekly plan cap in dollars. **Code, comments, CLI output and commit messages are in French**: keep them so.

## Commands

Node.js 20+, plain ES modules (`.mjs`), no `package.json`, no dependency, no build or lint step.

```
node agreger.mjs                 # logs → <data>/donnees.json (+ archive-appels.json)
node exporter.mjs                # donnees.json → <data>/export/*.json (13 tables + _tables.json), then CONTRÔLES / DÉPÔT lines
node --test                      # all tests
node --test semaine.test.mjs     # one file
node --test --test-name-pattern "lireResets" reglages.test.mjs   # one test
node maj-tarifs.mjs              # rewrite tarifs.json from the official Pricing page (refuses on any doubt)
node comparer-ccusage.mjs        # optional: per-day tokens vs pinned ccusage (npx, network); writes nothing
```

`agreger.mjs` options: `--journaux <projects dir>` (repeatable, logs from another PC), `--sortie <file>`,
`--journal-quota <sonar quota-log.jsonl>`.

`<data>` is `donnees/` (git-ignored) or `dossierDonnees` from `config.local.json` (git-ignored; template `config.exemple.json`).

Simulated data, in a copy of the repo without `config.local.json`:
`node demo/generer-demo.mjs ../demo-home && HOME=../demo-home node agreger.mjs && HOME=../demo-home node exporter.mjs`.

## Pipeline

1. **`agreger.mjs`** reads `~/.claude/projects/**/*.jsonl` (and on Windows, Cowork local sessions for history). It reads
   only `usage` / `model` / `timestamp` / path fields, **never message content**: keep it that way. It merges in the
   counter archive (Claude Code deletes old logs; the archive keeps every answer already counted), the sonar quota log
   (`~/.claude/sonar/quota-log.jsonl`), `rate_limit_event` lines, and manual `releves.json`. Costs use `tarifs.json`
   (built-in `INTEGRES` / `PALIERS_INTEGRES` are only a fallback). An unreadable archive stops the run: it must never be
   overwritten with less; it is written to a temp file and then renamed.
2. **`exporter.mjs`** turns `donnees.json` into the dashboard tables: off-PC usage detection (`HORS`), slopes, weekly caps,
   reset segments, plan-change weeks. It uses one `MAINTENANT` for the whole run. At the end it prints
   `rapport(controler(...))` (`CONTRÔLES : OK` or a list) and a `DÉPÔT` line if the git working tree changed: a data update
   must not change anything in the repo.
3. **`page/index.html`** is the page of a **claude.ai Dashboard artifact**, not a standalone page. It uses the platform's
   `dash.data(name)` / `dash.draw` / `dash.onData`, and opening it in a browser shows nothing. Each table in `export/` is
   one dataset with the same name.

## Module boundaries

- `config.mjs` is the only reader of `config.local.json`. It adds the `config.local.json : …` prefix to errors and exports
  `DONNEES`, `REMISE_A_ZERO`, `RESETS`, `RESETS_PRECIS`, `FORFAITS`, `TROUS`, `nomProjet`.
- `reglages.mjs` holds the pure validators (`lireCycle`, `lireResets`, `lireForfaits`): it imports nothing and reads no file.
  This is the canonical API; `semaine.mjs` re-exports `lireCycle` / `CYCLE_DEFAUT` for older imports.
- `semaine.mjs` is the only module that computes plan-week dates (`fabriquer(cycle)` → `debutSemaine`, `instantDebut`).
  The weekly cycle is in UTC (default Sunday 10:00), while calendar days are always Europe/Paris.
- `controles.mjs` is pure (no disk access, `maintenant` passed in). There are two levels: `anomalie` (a certain bug in
  agreger/exporter) and `aVerifier` (implausible but possibly true). It owns the status-text formats that the exporter
  writes and the checks and the page parse back: `suffixeCoupee`, `SUFFIXE_INDICATIF`, `forfaitDe`. Change them there, not
  inline.

## Tests

- `semaine`, `reglages` and `maj-tarifs` tests are pure. `maj-tarifs.test.mjs` breaks a saved copy of the Pricing page
  (`tests-pricing-20261113.md`) in one way per test.
- `controles.test.mjs` runs on **your real exported data** (`<data>/donnees.json` + `export/`) and breaks one thing per
  test. Without data every test is skipped, and a test needing more history than you have is skipped, not failed. Run
  `agreger` and then `exporter` first.

## Cross-file changes

- New model or price: run `node maj-tarifs.mjs`. To give the model its own chart series, add it to `GROUPES` in
  `exporter.mjs`; unknown models already get an automatic series key that the page displays.
- New or renamed table: update `exporter.mjs`, the page, `controles.mjs` if it is checked, and the table count/list in
  **both** `README.md` and `README.fr.md`. The two READMEs are kept in sync.
- New `config.local.json` key: add the validator in `reglages.mjs`, read it in `config.mjs`, add an example to
  `config.exemple.json` and a row to both READMEs.
