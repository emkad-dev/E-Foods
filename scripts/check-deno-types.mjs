#!/usr/bin/env node
// Type-checks the whole supabase/functions/** import graph with `deno check`
// and fails if the error count moves away from a pinned baseline, in either
// direction.
//
// Why a count gate instead of "deno check must pass": the domain modules
// that app-rpc (and the five split feasty-* functions) import have never
// type-checked. Task 1 (splitting app-rpc into domain modules) reconciled
// the pre-existing error count from 210 down to 206 and fully explained the
// delta — see
// .superpowers/sdd/2026-08-02-glovo-parity/task-1-report.md, section 6 note 2.
// Requiring a clean `deno check` here would either block unrelated tooling
// work on fixing that backlog, or invite quietly loosening the gate with
// `--no-check` on more files. A pinned count catches *new* errors on the
// first CI run that introduces them, without demanding the backlog be paid
// off first.
//
// Where the 212 below comes from: the 206 lived entirely inside
// app-rpc/index.ts's import graph (all five domain modules plus their shared
// deps — every other function's own index.ts type-checks clean on top of
// that same graph, verified by running this exact command by hand).
// `_shared/dispatchSelection.ts` (338 lines, zero importers, parked for
// Task 9 per docs/superpowers/plans/2026-08-02-glovo-parity.md) sits outside
// every entrypoint's import graph, so no `deno check` invocation could ever
// see it — it could rot silently and nothing would notice. It is listed as
// an explicit extra target below so it can't. Its 6 errors are additive and
// disjoint from the 206 (confirmed: checking it alongside every entrypoint
// adds exactly 6, not fewer — no overlap): 206 + 6 = 212.
//
// "Hard to game" means both directions are gated, not just increases: if you
// fix errors, EXPECTED_ERROR_COUNT must go down too. That is deliberate — a
// gate that only trips upward lets the count silently drift down over time
// with nobody reviewing why, which is just as capable of hiding a mistake
// (e.g. a file quietly falling out of the import graph) as an unnoticed
// increase would be. Moving the number at all requires touching this file in
// the diff, which is the actual enforcement mechanism: reviewers see it.
//
// This does NOT catch a new file that type-checks fine on its own but is
// never imported from anywhere (the same blind spot dispatchSelection.ts
// was in before this change) — deno check only ever sees what an entrypoint
// reaches. If you add a new orphaned shared module, add it to
// EXTRA_CHECK_TARGETS below by hand, the same way dispatchSelection.ts was.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXPECTED_ERROR_COUNT = 212;

// Modules with zero importers anywhere in supabase/functions/** — invisible
// to `deno check` unless listed here explicitly. See the block comment above.
const EXTRA_CHECK_TARGETS = ['supabase/functions/_shared/dispatchSelection.ts'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(repoRoot, 'supabase', 'functions');

function discoverEntrypoints() {
  const entries = readdirSync(functionsDir, { withFileTypes: true });
  const entrypoints = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '_shared') continue;
    const indexPath = path.join(functionsDir, entry.name, 'index.ts');
    try {
      if (statSync(indexPath).isFile()) {
        entrypoints.push(path.relative(repoRoot, indexPath).split(path.sep).join('/'));
      }
    } catch {
      // No index.ts in this function dir (shouldn't happen for a deployable
      // function) - skip rather than fail the discovery step; deno check
      // will simply not cover it, which is a visible gap, not a silent one.
    }
  }
  return entrypoints.sort();
}

const targets = [...discoverEntrypoints(), ...EXTRA_CHECK_TARGETS];

if (targets.length === 0) {
  console.error('check-deno-types: discovered zero entrypoints under supabase/functions/** - refusing to report a clean pass.');
  process.exit(1);
}

console.log(`check-deno-types: running deno check over ${targets.length} target(s):`);
for (const target of targets) console.log(`  - ${target}`);

const result = spawnSync('deno', ['check', '--no-lock', ...targets], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (result.error) {
  console.error('check-deno-types: failed to run `deno check` - is Deno installed and on PATH?');
  console.error(result.error.message);
  process.exit(1);
}

const stderr = result.stderr ?? '';
const match = stderr.match(/Found (\d+) errors?\./);

let actualErrorCount;
if (match) {
  actualErrorCount = Number(match[1]);
} else if (result.status === 0) {
  actualErrorCount = 0;
} else {
  // Non-zero exit with no "Found N errors." line means something other than
  // ordinary type errors went wrong (crash, bad flag, missing file). Surface
  // it verbatim rather than guessing a count.
  console.error('check-deno-types: `deno check` failed without a parseable error count. Raw output follows.');
  console.error(result.stdout);
  console.error(stderr);
  process.exit(1);
}

console.log(`check-deno-types: deno check reported ${actualErrorCount} error(s); baseline is ${EXPECTED_ERROR_COUNT}.`);

if (actualErrorCount !== EXPECTED_ERROR_COUNT) {
  const direction = actualErrorCount > EXPECTED_ERROR_COUNT ? 'increased' : 'decreased';
  console.error('');
  console.error(`check-deno-types: FAIL - deno check error count ${direction} from ${EXPECTED_ERROR_COUNT} to ${actualErrorCount}.`);
  if (actualErrorCount > EXPECTED_ERROR_COUNT) {
    console.error('This means new type errors were introduced. Fix them, or if the new error is');
    console.error('genuinely pre-existing and unrelated, explain why in the PR and only then update');
    console.error('EXPECTED_ERROR_COUNT in scripts/check-deno-types.mjs.');
  } else {
    console.error('This means some pre-existing errors were fixed - nice. Update EXPECTED_ERROR_COUNT');
    console.error('in scripts/check-deno-types.mjs down to the new number so the improvement sticks.');
  }
  console.error('');
  console.error(stderr);
  process.exit(1);
}

console.log('check-deno-types: OK - error count matches the pinned baseline.');
process.exit(0);
