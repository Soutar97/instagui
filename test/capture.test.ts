import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureHelp,
  isUsableHelp,
  stripManFormatting,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  type RunFn,
  type RunOutcome,
} from '../src/core/capture.js';
import { ToolNotFoundError, NoHelpError } from '../src/core/errors.js';

const HELP = 'Usage: t [options]\n  --foo   do the foo thing\n  -b BAR  set bar\n';

function outcome(partial: Partial<RunOutcome>): RunOutcome {
  return { stdout: '', stderr: '', code: 0, timedOut: false, capped: false, ...partial };
}
function enoent(): RunOutcome {
  return outcome({ code: null, spawnError: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
}

/** Strip the Windows executable suffix so keys are platform-agnostic (captureHelp tries
 *  `t.exe`/`t.com` before `t` on win32). */
function baseCmd(cmd: string): string {
  return cmd.replace(/\.(exe|com|bat|cmd)$/i, '');
}

/** Fake runner keyed by "cmd args". Unlisted keys → empty (no usable help). */
function runner(map: Record<string, RunOutcome>, calls?: string[]): RunFn {
  return async (cmd, args) => {
    const key = `${baseCmd(cmd)} ${args.join(' ')}`.trim();
    calls?.push(key);
    return map[key] ?? outcome({ stdout: '', code: 1 });
  };
}

test('pinned limits are 10s / 1MB', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 10_000);
  assert.equal(DEFAULT_MAX_BYTES, 1_000_000);
});

test('isUsableHelp accepts real help, rejects short text and flag-errors', () => {
  assert.equal(isUsableHelp(HELP), true);
  assert.equal(isUsableHelp('   '), false);
  assert.equal(isUsableHelp('short'), false);
  assert.equal(isUsableHelp('unknown option --help\nTry -h'), false);
});

test('stripManFormatting removes backspace overstrike', () => {
  assert.equal(stripManFormatting('N\x08NA\x08AM\x08ME\x08E'), 'NAME');
});

test('fallback order: --help empty → -h wins', async () => {
  const calls: string[] = [];
  const run = runner({ 't -h': outcome({ stdout: HELP }) }, calls);
  const res = await captureHelp('t', { runner: run, tryMan: false });
  assert.equal(res.method, '-h');
  assert.equal(res.helpText.includes('--foo'), true);
  assert.deepEqual(calls.slice(0, 2), ['t --help', 't -h']); // tried --help first, then -h
});

test('help printed to stderr is still captured (both streams read)', async () => {
  const run = runner({ 't --help': outcome({ stdout: '', stderr: HELP }) });
  const res = await captureHelp('t', { runner: run, tryMan: false });
  assert.equal(res.method, '--help');
  assert.match(res.helpText, /--foo/);
});

test('ENOENT on all candidates → ToolNotFoundError', async () => {
  const run: RunFn = async () => enoent();
  await assert.rejects(() => captureHelp('nope', { runner: run }), ToolNotFoundError);
});

test('timeout on --help falls through to -h', async () => {
  const run = runner({
    't --help': outcome({ timedOut: true, code: null }),
    't -h': outcome({ stdout: HELP }),
  });
  const res = await captureHelp('t', { runner: run, tryMan: false });
  assert.equal(res.method, '-h');
});

test('all probes fail, man disabled → NoHelpError', async () => {
  const run: RunFn = async () => outcome({ stdout: '', code: 1 });
  await assert.rejects(() => captureHelp('t', { runner: run, tryMan: false }), NoHelpError);
});

test('man fallback used when flags yield nothing; formatting stripped', async () => {
  const manRaw = 'N\x08NA\x08AM\x08ME\x08E\n  t - ' + HELP;
  const run = runner({ 'man t': outcome({ stdout: manRaw }) });
  const res = await captureHelp('t', { runner: run });
  assert.equal(res.method, 'man');
  assert.match(res.helpText, /^NAME/); // overstrike collapsed
  assert.equal(res.helpText.includes('\x08'), false);
});

test('capped-but-usable output is returned (truncated)', async () => {
  const big = 'Usage: t [options]\n' + 'x'.repeat(50);
  const run = runner({ 't --help': outcome({ stdout: big, capped: true }) });
  const res = await captureHelp('t', { runner: run, tryMan: false });
  assert.equal(res.method, '--help');
  assert.match(res.helpText, /Usage: t/);
});

// --- Real spawn path (uses `node` as a stand-in tool; no external deps) ---

test('real spawn: node --help yields usable help via defaultRun', async () => {
  const res = await captureHelp('node', { argSets: [['--help']], tryMan: false, timeoutMs: 8000 });
  assert.equal(res.method, '--help');
  assert.match(res.helpText, /[Uu]sage/);
});

test('real spawn: a hanging probe is killed at the timeout (no hang)', async () => {
  const start = Date.now();
  await assert.rejects(
    () =>
      captureHelp('node', {
        argSets: [['-e', 'setTimeout(() => {}, 60000)']],
        tryMan: false,
        timeoutMs: 600,
      }),
    NoHelpError,
  );
  assert.ok(Date.now() - start < 5000, 'must not hang past the timeout');
});

test('real spawn: flooding output is capped and killed', async () => {
  const res = await captureHelp('node', {
    argSets: [['-e', 'const s="Usage: flood ".padEnd(100,"x")+"\\n"; while(true) process.stdout.write(s)']],
    tryMan: false,
    maxBytes: 2000,
    timeoutMs: 8000,
  });
  assert.ok(res.helpText.length <= 2000, `capped to <=2000, got ${res.helpText.length}`);
  assert.match(res.helpText, /Usage: flood/);
});
