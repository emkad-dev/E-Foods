/**
 * Run with: node --test --experimental-strip-types packages/domain/src/rpcRoutes.test.ts
 *
 * Two guardrails this file is designed around, mirroring
 * supabase/functions/_shared/rpc/registry.test.ts's own comment:
 *
 *   1. The per-domain/total action counts below are hardcoded independently
 *      of scripts/rpc-routes-lib.mjs's own EXPECTED_DOMAIN_ACTION_COUNTS —
 *      NOT imported from it. rpc-routes-lib.mjs is itself under test here
 *      (via the drift check below); if this file imported its constants, a
 *      bug in that module's expected counts could rubber-stamp itself
 *      instead of failing a fixed, separately-maintained expectation.
 *
 *   2. The drift check re-parses actions.ts with its own independent regex
 *      (extractActionArrayIndependently, deliberately duplicated rather than
 *      calling rpc-routes-lib.mjs's extractActionArray) and asserts the
 *      committed packages/domain/src/rpcRoutes.ts agrees with it. It must
 *      never "fix" rpcRoutes.ts — only fail loudly when it disagrees.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEGACY_RPC_FUNCTION,
  RPC_ROUTES,
  resolveRpcFunction,
  resolveRpcMode,
  resolveRpcTarget,
} from './rpcRoutes.ts';

// The generator always writes LF; on a Windows checkout with
// core.autocrlf=true the committed file can check out as CRLF (a
// .gitattributes entry pins rpcRoutes.ts to eol=lf to prevent that going
// forward, but this normalization is a second line of defense so a raw
// string comparison here never reports a false "drift" — and never
// overwrites the tracked file — over a line-ending difference alone).
const normalizeLineEndings = (text: string): string => text.replace(/\r\n/g, '\n');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ACTIONS_SOURCE_PATH = path.join(REPO_ROOT, 'supabase', 'functions', '_shared', 'rpc', 'actions.ts');
const RPC_ROUTES_OUTPUT_PATH = path.join(REPO_ROOT, 'packages', 'domain', 'src', 'rpcRoutes.ts');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts', 'generate-rpc-routes.mjs');

// Independently-maintained copy of the Task 3 brief's action-count contract.
// Do NOT derive these from scripts/rpc-routes-lib.mjs.
const EXPECTED_DOMAIN_ACTION_COUNTS = {
  ORDER_ACTIONS: 12,
  DISPATCH_ACTIONS: 11,
  PARTNER_ACTIONS: 10,
  ADMIN_ACTIONS: 21,
  ACCOUNT_ACTIONS: 12,
};
const EXPECTED_TOTAL_ACTIONS = 66;

const actionsSource = fs.readFileSync(ACTIONS_SOURCE_PATH, 'utf8');

/**
 * Re-parses actions.ts with its own regex, independent of
 * scripts/rpc-routes-lib.mjs's extractActionArray, so a shared bug between
 * generation and this test can't cancel out.
 */
const extractActionArrayIndependently = (source: string, constName: string): string[] => {
  const re = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\]\\s*as const;`);
  const match = source.match(re);
  assert.ok(match, `could not find "export const ${constName} = [...] as const;" in actions.ts`);
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

test('actions.ts has exactly the expected per-domain action counts', () => {
  for (const [constName, expectedCount] of Object.entries(EXPECTED_DOMAIN_ACTION_COUNTS)) {
    const actions = extractActionArrayIndependently(actionsSource, constName);
    assert.equal(actions.length, expectedCount, `${constName} should have exactly ${expectedCount} actions`);
  }
});

test('actions.ts has exactly 66 total actions across all five domains', () => {
  const total = Object.keys(EXPECTED_DOMAIN_ACTION_COUNTS).reduce(
    (sum, constName) => sum + extractActionArrayIndependently(actionsSource, constName).length,
    0
  );
  assert.equal(total, EXPECTED_TOTAL_ACTIONS);
});

test('RPC_ROUTES covers exactly the 66 actions', () => {
  assert.equal(Object.keys(RPC_ROUTES).length, EXPECTED_TOTAL_ACTIONS);
});

test('generated rpcRoutes.ts has not drifted from actions.ts', async () => {
  const { buildRpcRoutes } = await import('../../../scripts/rpc-routes-lib.mjs');
  const { rpcRoutes: expected } = (buildRpcRoutes as (source: string) => { rpcRoutes: Record<string, string> })(
    actionsSource
  );
  assert.deepEqual(RPC_ROUTES, expected);
});

test('resolveRpcFunction throws on an unknown action', () => {
  assert.throws(() => resolveRpcFunction('notARealAction'), /Unknown RPC action/);
});

test('resolveRpcTarget throws on an unknown action in both split and legacy modes', () => {
  assert.throws(() => resolveRpcTarget('notARealAction', 'split'), /Unknown RPC action/);
  assert.throws(() => resolveRpcTarget('notARealAction', 'legacy'), /Unknown RPC action/);
});

test('legacy mode maps every known action to app-rpc', () => {
  for (const action of Object.keys(RPC_ROUTES)) {
    assert.equal(resolveRpcTarget(action, 'legacy'), LEGACY_RPC_FUNCTION);
  }
});

test('split mode maps each action to its RPC_ROUTES domain function', () => {
  for (const [action, fn] of Object.entries(RPC_ROUTES)) {
    assert.equal(resolveRpcTarget(action, 'split'), fn);
  }
});

test('resolveRpcMode resolves unset/blank/unrecognized values to split', () => {
  assert.equal(resolveRpcMode(undefined), 'split');
  assert.equal(resolveRpcMode(null), 'split');
  assert.equal(resolveRpcMode(''), 'split');
  assert.equal(resolveRpcMode('   '), 'split');
  assert.equal(resolveRpcMode('bogus'), 'split');
  assert.equal(resolveRpcMode('spl1t'), 'split');
});

test('resolveRpcMode resolves "legacy" case- and whitespace-insensitively', () => {
  assert.equal(resolveRpcMode('legacy'), 'legacy');
  assert.equal(resolveRpcMode('LEGACY'), 'legacy');
  assert.equal(resolveRpcMode('  Legacy  '), 'legacy');
});

test('generator is idempotent and matches the committed file, without writing to it', () => {
  // Runs the real generator CLI twice, but redirected (via its optional
  // argv[2] output-path override) to a scratch file in a temp dir — never
  // the tracked packages/domain/src/rpcRoutes.ts. A prior version of this
  // test wrote directly to the tracked file: on a fresh Windows checkout
  // (core.autocrlf=true, no .gitattributes pin) that produced a misleading
  // "drifted" failure from a pure line-ending mismatch, and — because the
  // test still passed on a second run — silently rewrote a tracked file
  // (and any in-progress hand edit to it) as a side effect of `npm test`.
  // This version never writes to a tracked path and normalizes line
  // endings before comparing, so only real content drift can fail it.
  const committed = normalizeLineEndings(fs.readFileSync(RPC_ROUTES_OUTPUT_PATH, 'utf8'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-routes-idempotency-'));
  const tmpOutputPath = path.join(tmpDir, 'rpcRoutes.ts');

  try {
    execFileSync(process.execPath, [GENERATOR_PATH, tmpOutputPath], { stdio: 'pipe' });
    const firstRun = normalizeLineEndings(fs.readFileSync(tmpOutputPath, 'utf8'));
    assert.equal(
      firstRun,
      committed,
      'the generator\'s output no longer matches the committed rpcRoutes.ts — run `npm run generate:rpc-routes` and commit the result'
    );

    execFileSync(process.execPath, [GENERATOR_PATH, tmpOutputPath], { stdio: 'pipe' });
    const secondRun = normalizeLineEndings(fs.readFileSync(tmpOutputPath, 'utf8'));
    assert.equal(secondRun, firstRun, 'a second regeneration produced different output — generator is not idempotent');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
