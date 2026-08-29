'use strict';

/**
 * smoke.js — headless end-to-end check of the shell's server management,
 * without opening any window (pure Node, no Electron).
 *
 *   node scripts/smoke.js [--port 3090]
 *
 * Verifies:
 *   1. probe() against the default port (expects an existing dsh web — the
 *      one you are likely running right now).
 *   2. full spawn path: startDsh on a scratch port with a scratch DSH_HOME
 *      and workspace-local npm cache, waitUntilReady, then stopDsh and
 *      confirm the port went down again.
 *
 * Exit 0 on success, non-zero on failure.
 */

const path = require('path');
const {
  DEFAULT_PORT,
  probe,
  startDsh,
  stopDsh,
  waitUntilReady,
} = require('../src/server-manager');

const ROOT = path.join(__dirname, '..');
const SCRATCH_PORT = 3090;
const SCRATCH_HOME = path.join(ROOT, '.smoke-dsh-home');
const NPM_CACHE = path.join(ROOT, '.npm-cache');

let failures = 0;

function check(name, cond, extra = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const scratchPort = portIdx >= 0 ? Number(args[portIdx + 1]) : SCRATCH_PORT;

  // 1. existing instance on the default port (if any)
  const existing = await probe(DEFAULT_PORT);
  console.log(`[info] default port ${DEFAULT_PORT} state: ${existing}`);
  if (existing !== 'dsh') {
    console.log('[warn] no dsh web running on the default port — step 1 expected one (3080).');
    console.log('       Continuing with the spawn test anyway; step 1 is informational.');
  }

  // 2. full spawn path on the scratch port
  console.log(`\n[spawn] starting dsh web on port ${scratchPort} ...`);
  console.log(`[spawn] scratch DSH_HOME: ${SCRATCH_HOME}`);
  const lines = [];
  const child = await startDsh({
    port: scratchPort,
    env: {
      DSH_HOME: SCRATCH_HOME,
      npm_config_cache: NPM_CACHE,
    },
    onLog: (line) => {
      lines.push(line);
      if (process.env.SMOKE_VERBOSE) console.log(line);
    },
  });

  const result = await waitUntilReady(scratchPort, {
    timeoutMs: 300000,
    onAttempt: (attempt) => {
      if (attempt % 10 === 0) console.log(`[spawn] ... probe attempt ${attempt}`);
    },
  });

  check(
    'spawned dsh web becomes ready on scratch port',
    result.ok,
    result.ok ? `after ${result.attempts} probes` : `reason: ${result.reason}`,
  );

  if (result.ok) {
    const stateBefore = await probe(scratchPort);
    check('probe returns "dsh" while running', stateBefore === 'dsh', `state=${stateBefore}`);

    await stopDsh(child);
    // give the tree a moment to die
    await sleep(1500);
    const stateAfter = await probe(scratchPort);
    check('port is down after stopDsh', stateAfter === 'down', `state=${stateAfter}`);
  }

  if (failures > 0) {
    console.log(`\n[tail] last 20 lines of spawned dsh output:`);
    console.log(lines.slice(-20).join('\n'));
    console.log(`\n${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exitCode = 1;
});
