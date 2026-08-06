#!/usr/bin/env node
// Type-checks the whole supabase/functions/** import graph with `deno check`
// and fails if the *set* of type errors differs from a committed baseline -
// not just the count.
//
// Why a baseline gate instead of "deno check must pass": the domain modules
// that app-rpc (and the five split feasty-* functions) import have never
// type-checked. Task 1 (splitting app-rpc into domain modules) reconciled
// the pre-existing error count from 210 down to 206 and fully explained the
// delta - see
// .superpowers/sdd/2026-08-02-glovo-parity/task-1-report.md, section 6 note 2.
// Requiring a clean `deno check` here would either block unrelated tooling
// work on fixing that backlog, or invite quietly loosening the gate with
// `--no-check` on more files. A pinned baseline catches *new* errors on the
// first CI run that introduces them, without demanding the backlog be paid
// off first.
//
// Why fingerprints, not just a count (fixed after code review): a plain
// integer comparison passes on a compensating pair - fix one pre-existing
// error, introduce one new one elsewhere, and the count nets out unchanged
// while a real regression slipped through silently. The 206 pre-existing
// errors are concentrated in _shared/domains/*, exactly the files Phase B
// plans to edit, so this was not a hypothetical. Each error is fingerprinted
// as `relative/path.ts:line:TScode` and the full set is compared against
// scripts/deno-check-baseline.txt (committed). Any fingerprint present now
// but absent from the baseline is a new error - fail. Any fingerprint in the
// baseline but no longer reported is a fixed error - also fail, with an
// instruction to regenerate the baseline, so an improvement gets locked in
// deliberately (via a reviewable diff) instead of just being allowed to
// happen silently in either direction.
//
// Where the 212-line baseline comes from: the 206 lived entirely inside
// app-rpc/index.ts's import graph (all five domain modules plus their shared
// deps - every other function's own index.ts type-checks clean on top of
// that same graph, verified by running this exact command by hand).
// `_shared/dispatchSelection.ts` (338 lines, zero importers, parked for
// Task 9 per docs/superpowers/plans/2026-08-02-glovo-parity.md) sits outside
// every entrypoint's import graph, so no `deno check` invocation could ever
// see it - it could rot silently and nothing would notice. It is listed as
// an explicit extra target below so it can't. Its 6 errors are additive and
// disjoint from the 206 (confirmed: checking it alongside every entrypoint
// adds exactly 6, not fewer - no overlap): 206 + 6 = 212 fingerprints.
//
// Reproducibility (fixed after code review): this used to run with
// `--no-lock`, and CI's `deno-version: v2.x` floats. `_shared/client.ts`
// imports `npm:@supabase/supabase-js@2` - an unpinned major-version range -
// inside the checked graph, reachable from nearly every function. Without a
// lockfile, a new supabase-js *patch* release (or a new Deno *point*
// release changing its own lib.d.ts) can shift the error set for reasons
// that have nothing to do with any change in this repo, and the fastest way
// to unblock an unrelated PR when that happens is to bump the pin - which is
// exactly the erosion this gate exists to prevent. Fixed by committing
// scripts/deno-check.lock (`deno cache --lock=scripts/deno-check.lock
// <targets>`, pins @supabase/supabase-js to 2.110.2 as resolved at the time
// this gate was built) and running with `--lock=... --frozen` instead of
// `--no-lock`, plus pinning `deno-version: '2.9.3'` in ci.yml to the exact
// version this was validated against. `--frozen` errors out rather than
// silently rewriting the lock if resolution ever disagrees with it.
//
// This does NOT catch a new file that type-checks fine on its own but is
// never imported from anywhere (the same blind spot dispatchSelection.ts
// was in before this change) - deno check only ever sees what an entrypoint
// reaches. If you add a new orphaned shared module, add it to
// EXTRA_CHECK_TARGETS below by hand, the same way dispatchSelection.ts was.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Modules with zero importers anywhere in supabase/functions/** - invisible
// to `deno check` unless listed here explicitly. See the block comment above.
const EXTRA_CHECK_TARGETS = ['supabase/functions/_shared/dispatchSelection.ts'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(repoRoot, 'supabase', 'functions');
const lockPath = path.join(repoRoot, 'scripts', 'deno-check.lock');
const baselinePath = path.join(repoRoot, 'scripts', 'deno-check-baseline.txt');

const writeBaseline = process.argv.includes('--write-baseline');

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

if (!existsSync(lockPath)) {
  console.error(`check-deno-types: lock file not found at ${path.relative(repoRoot, lockPath)}.`);
  console.error('Regenerate it with: deno cache --lock=scripts/deno-check.lock <targets> (see this file\'s header comment).');
  process.exit(1);
}

console.log(`check-deno-types: running deno check over ${targets.length} target(s):`);
for (const target of targets) console.log(`  - ${target}`);

const result = spawnSync(
  'deno',
  ['check', `--lock=${path.relative(repoRoot, lockPath)}`, '--frozen', ...targets],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    // NO_COLOR forces plain output so the fingerprint parser below doesn't
    // have to fight ANSI escape codes wrapping file paths and line numbers -
    // deno emits color even when stdio is piped (verified: it is NOT purely
    // a TTY-detection default here).
    env: { ...process.env, NO_COLOR: '1' },
  }
);

if (result.error) {
  console.error('check-deno-types: failed to run `deno check` - is Deno installed and on PATH?');
  console.error(result.error.message);
  process.exit(1);
}

const stderr = result.stderr ?? '';

if (/error: Lock file is out of date/i.test(stderr) || /lockfile is out of date/i.test(stderr)) {
  console.error('check-deno-types: FAIL - the lock file at scripts/deno-check.lock is out of date.');
  console.error('This means a dependency (e.g. npm:@supabase/supabase-js) would resolve to a');
  console.error('different version than the one pinned. Regenerate deliberately with:');
  console.error('  deno cache --lock=scripts/deno-check.lock <targets listed above>');
  console.error('and review the diff before committing it.');
  console.error('');
  console.error(stderr);
  process.exit(1);
}

const foundMatch = stderr.match(/Found (\d+) errors?\./);
const reportedCount = foundMatch ? Number(foundMatch[1]) : result.status === 0 ? 0 : null;

if (reportedCount === null) {
  console.error('check-deno-types: `deno check` failed without a parseable error count. Raw output follows.');
  console.error(result.stdout);
  console.error(stderr);
  process.exit(1);
}

// Each error block looks like:
//   TS18048 [ERROR]: 'nextState' is possibly 'undefined'.
//         status: nextState.status,
//                 ~~~~~~~~~
//       at file:///abs/path/to/file.ts:800:15
//
// Non-greedy match up to the FIRST "at file://...:line:col" after the code
// deliberately stops at the primary diagnostic location, not a secondary
// "'x' is declared here" cross-reference that some errors also print.
const fingerprintRegex = /(TS\d+) \[ERROR\]:[\s\S]*?\n\s*at (file:\/\/\/\S+):(\d+):\d+/g;
const fingerprints = [];
let match;
while ((match = fingerprintRegex.exec(stderr))) {
  const [, code, fileUrl, line] = match;
  const relFile = path.relative(repoRoot, fileURLToPath(fileUrl)).split(path.sep).join('/');
  fingerprints.push(`${relFile}:${line}:${code}`);
}

if (fingerprints.length !== reportedCount) {
  console.error(
    `check-deno-types: FAIL - parsed ${fingerprints.length} error fingerprint(s) but deno reported ${reportedCount}.`
  );
  console.error('The fingerprint parser did not recognise every error block - treating this as a');
  console.error('parse failure rather than silently checking a partial set. Raw output follows.');
  console.error(stderr);
  process.exit(1);
}

// Deduped to unique locations: the same _shared file can be reached (and
// therefore diagnosed) from more than one entrypoint in a single multi-file
// `deno check` invocation, which reports the same file:line:code more than
// once. The raw occurrence count is what's cross-checked against deno's own
// "Found N errors." above; the baseline tracks unique defect locations, not
// how many entrypoints happen to reach each one.
const currentSet = new Set(fingerprints);
const sortedCurrent = [...currentSet].sort();

if (writeBaseline) {
  writeFileSync(baselinePath, sortedCurrent.join('\n') + '\n', 'utf8');
  console.log(`check-deno-types: wrote ${sortedCurrent.length} fingerprint(s) to ${path.relative(repoRoot, baselinePath)}.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`check-deno-types: baseline not found at ${path.relative(repoRoot, baselinePath)}.`);
  console.error('Generate it with: node scripts/check-deno-types.mjs --write-baseline');
  process.exit(1);
}

const baselineSet = new Set(
  readFileSync(baselinePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
);

const added = sortedCurrent.filter((fp) => !baselineSet.has(fp));
const removed = [...baselineSet].filter((fp) => !currentSet.has(fp)).sort();

console.log(
  `check-deno-types: deno check reported ${fingerprints.length} error occurrence(s) across ` +
    `${currentSet.size} unique location(s); baseline has ${baselineSet.size} unique location(s).`
);

if (added.length === 0 && removed.length === 0) {
  console.log('check-deno-types: OK - error set matches the committed baseline exactly.');
  process.exit(0);
}

console.error('');
if (added.length > 0) {
  console.error(`check-deno-types: FAIL - ${added.length} new error(s) not in the baseline:`);
  for (const fp of added) console.error(`  + ${fp}`);
}
if (removed.length > 0) {
  console.error(`check-deno-types: FAIL - ${removed.length} baselined error(s) no longer reported (fixed):`);
  for (const fp of removed) console.error(`  - ${fp}`);
  console.error('');
  console.error('If these were genuinely fixed, regenerate the baseline to lock the improvement in:');
  console.error('  node scripts/check-deno-types.mjs --write-baseline');
}
console.error('');
console.error('If new errors were introduced, fix them. A net-zero count with a different error set');
console.error('(e.g. one error fixed, one unrelated error introduced) is exactly what this gate is');
console.error('designed to still catch - do not "resolve" this by regenerating the baseline unless');
console.error('every entry in both lists above has been individually reviewed.');
process.exit(1);
