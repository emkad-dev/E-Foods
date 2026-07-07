#!/usr/bin/env node
// Ramp / stress orchestrator.
//
// Wraps scripts/load-test-backend.mjs (the validated per-request load harness)
// and runs it in successive short stages at rising concurrency, watching for the
// saturation knee: the stage where error-rate crosses a threshold, or p95 latency
// blows past a multiple of the baseline, or throughput stalls while latency climbs.
//
// It reuses the child harness's request logic verbatim (same env contract), so
// the ramp is honest about what the app actually does under load.
//
// Env (in addition to everything load-test-backend.mjs reads):
//   RAMP_STAGES         comma list of concurrency levels (default "5,10,25,50,100,200,400")
//   STAGE_SECONDS       seconds per stage (default 20)
//   ERROR_THRESHOLD     fractional error rate that marks a breakpoint (default 0.02 = 2%)
//   LATENCY_KNEE_MULT   p95 multiple over baseline that marks a breakpoint (default 8)
//   STAGES_PAST_KNEE    extra stages to run after first breakpoint to characterize (default 1)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(__dirname, 'load-test-backend.mjs');

// Load an env file WITHOUT going through a shell (JSON values contain {,} which
// bash brace-expands and corrupts). Everything after the first '=' is the raw
// literal value. Existing process.env wins, so CLI overrides still work.
const loadEnvFile = (file) => {
  if (!fs.existsSync(file)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1);
      n += 1;
    }
  }
  return n;
};

const envFile = process.env.RAMP_ENV_FILE || path.join(__dirname, '.loadtest.env');
const loaded = loadEnvFile(envFile);
if (loaded > 0) console.log(`loaded ${loaded} vars from ${path.basename(envFile)}`);

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const stages = (process.env.RAMP_STAGES?.trim() || '5,10,25,50,100,200,400')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const stageSeconds = num(process.env.STAGE_SECONDS, 20);
const errorThreshold = num(process.env.ERROR_THRESHOLD, 0.02);
const latencyKneeMult = num(process.env.LATENCY_KNEE_MULT, 8);
const stagesPastKnee = num(process.env.STAGES_PAST_KNEE, 1);

// Run the child harness once at a given concurrency; collect the per-action JSON
// lines it prints on stdout and fold them into one stage-level summary.
const runStage = (concurrency) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARNESS], {
      env: {
        ...process.env,
        CONCURRENCY: String(concurrency),
        DURATION_SECONDS: String(stageSeconds),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const actions = [];
      for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed.action === 'string') actions.push(parsed);
        } catch {
          /* non-JSON log line */
        }
      }

      if (code !== 0 && actions.length === 0) {
        reject(new Error(`Harness exited ${code} at concurrency ${concurrency}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
        return;
      }

      const totalCount = actions.reduce((s, a) => s + (a.count || 0), 0);
      const totalErrors = actions.reduce((s, a) => s + (a.errors || 0), 0);
      const p95 = Math.max(0, ...actions.map((a) => a.p95Ms || 0));
      const p99 = Math.max(0, ...actions.map((a) => a.p99Ms || 0));
      const p50 = Math.max(0, ...actions.map((a) => a.p50Ms || 0));
      const throughput = totalCount / stageSeconds;
      const errorRate = totalCount > 0 ? totalErrors / totalCount : 0;
      const firstError = actions.find((a) => a.lastError)?.lastError || null;

      resolve({
        concurrency,
        totalCount,
        totalErrors,
        errorRate,
        throughput,
        p50,
        p95,
        p99,
        firstError,
        actions,
      });
    });
  });

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');

console.log(`\n=== STRESS RAMP ===`);
console.log(`stages=[${stages.join(', ')}] stageSeconds=${stageSeconds} errorThreshold=${(errorThreshold * 100).toFixed(1)}% latencyKneeMult=${latencyKneeMult}x\n`);

const results = [];
let baselineP95 = null;
let breakpoint = null;
let stagesAfterKnee = 0;

for (const concurrency of stages) {
  process.stdout.write(`stage c=${concurrency} ... `);
  let stage;
  try {
    stage = await runStage(concurrency);
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    breakpoint = { concurrency, reason: `harness failed: ${error.message}`, hard: true };
    break;
  }

  results.push(stage);
  if (baselineP95 == null && stage.p95 > 0) baselineP95 = stage.p95;

  console.log(
    `rps=${fmt(stage.throughput)} n=${stage.totalCount} err=${(stage.errorRate * 100).toFixed(2)}% ` +
      `p50=${fmt(stage.p50)}ms p95=${fmt(stage.p95)}ms p99=${fmt(stage.p99)}ms` +
      (stage.firstError ? `  lastError="${stage.firstError}"` : '')
  );

  const reasons = [];
  if (stage.errorRate > errorThreshold) {
    reasons.push(`error rate ${(stage.errorRate * 100).toFixed(2)}% > ${(errorThreshold * 100).toFixed(1)}%`);
  }
  if (baselineP95 && stage.p95 > baselineP95 * latencyKneeMult) {
    reasons.push(`p95 ${fmt(stage.p95)}ms > ${latencyKneeMult}× baseline (${fmt(baselineP95)}ms)`);
  }
  // Saturation knee: throughput regressed vs previous stage while latency rose.
  const prev = results[results.length - 2];
  if (prev && stage.throughput < prev.throughput * 0.95 && stage.p95 > prev.p95 * 1.5) {
    reasons.push(`throughput fell (${fmt(prev.throughput)}→${fmt(stage.throughput)} rps) while p95 rose (${fmt(prev.p95)}→${fmt(stage.p95)}ms)`);
  }

  if (reasons.length > 0 && !breakpoint) {
    breakpoint = { concurrency, reason: reasons.join('; '), stage };
    console.log(`\n  >>> BREAKPOINT at concurrency=${concurrency}: ${breakpoint.reason}\n`);
  }

  if (breakpoint) {
    stagesAfterKnee += 1;
    if (stagesAfterKnee > stagesPastKnee) break;
  }
}

console.log(`\n=== RAMP REPORT ===`);
console.log('concurrency | rps    | err%   | p50   | p95    | p99');
console.log('------------|--------|--------|-------|--------|-------');
for (const r of results) {
  console.log(
    `${String(r.concurrency).padStart(11)} | ${fmt(r.throughput).padStart(6)} | ${(r.errorRate * 100).toFixed(2).padStart(6)} | ${fmt(r.p50).padStart(5)} | ${fmt(r.p95).padStart(6)} | ${fmt(r.p99)}`
  );
}

if (breakpoint) {
  const lastGood = results[results.findIndex((r) => r.concurrency === breakpoint.concurrency) - 1];
  console.log(`\nBREAKPOINT: concurrency=${breakpoint.concurrency} — ${breakpoint.reason}`);
  if (lastGood) {
    console.log(`Last healthy stage: concurrency=${lastGood.concurrency} at ${fmt(lastGood.throughput)} rps, p95=${fmt(lastGood.p95)}ms, err=${(lastGood.errorRate * 100).toFixed(2)}%`);
  }
  process.exitCode = 0;
} else {
  console.log(`\nNo breakpoint reached within stages [${stages.join(', ')}]. App absorbed the full ramp — raise RAMP_STAGES to push further.`);
}
