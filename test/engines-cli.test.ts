import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod/v4';
import { buildCliArgv, createCliComplete, cliAvailable, assertCliReady } from '../src/shared/engines/cli.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineDescriptor } from '../src/shared/engines/types.js';

const Demo = z.object({ tool: z.string() });
const req = { model: 'sonnet', system: 'SYS', user: 'USR', outputSchema: Demo };

const claude: EngineDescriptor = {
  name: 'claude', kind: 'cli', binary: 'claude', headlessArgs: ['-p'], modelFlag: '--model',
  promptVia: 'stdin', model: 'sonnet', modelMap: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
};

test('buildCliArgv (stdin mode) puts the prompt on stdin and maps the model alias', () => {
  const { argv, stdin } = buildCliArgv(claude, 'claude-3-5-haiku', 'PROMPT');
  assert.deepEqual(argv, ['-p', '--model', 'haiku']);
  assert.equal(stdin, 'PROMPT');
});

test('buildCliArgv (arg mode with promptFlag) passes the prompt as an argument', () => {
  const gemini: EngineDescriptor = { name: 'gemini', kind: 'cli', binary: 'gemini', headlessArgs: [], modelFlag: '--model', promptVia: 'arg', promptFlag: '-p' };
  const { argv, stdin } = buildCliArgv(gemini, 'gemini-2.5-flash', 'PROMPT');
  assert.deepEqual(argv, ['--model', 'gemini-2.5-flash', '-p', 'PROMPT']);
  assert.equal(stdin, '');
});

test('createCliComplete composes system+user+schema and returns extracted JSON', async () => {
  let seenStdin = ''; let seenArgv: string[] = [];
  const run = async (_bin: string, argv: string[], stdin: string) => { seenArgv = argv; seenStdin = stdin; return { stdout: '```json\n{"tool":"cli"}\n```', stderr: '', code: 0 }; };
  const out = await createCliComplete(claude, { run, onPath: () => true })(req);
  assert.equal(out, '{"tool":"cli"}');
  assert.match(seenStdin, /SYS/);
  assert.match(seenStdin, /USR/);
  assert.match(seenStdin, /JSON Schema:/);
  assert.deepEqual(seenArgv, ['-p', '--model', 'sonnet']);
});

test('non-zero exit → PreconditionError with stderr', async () => {
  const run = async () => ({ stdout: '', stderr: 'boom', code: 1 });
  await assert.rejects(() => createCliComplete(claude, { run, onPath: () => true })(req), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /boom/);
    return true;
  });
});

test('availability + readiness follow PATH; missing binary → actionable error', () => {
  assert.equal(cliAvailable(claude, { onPath: () => true }), true);
  assert.equal(cliAvailable(claude, { onPath: () => false }), false);
  assert.throws(() => assertCliReady(claude, { onPath: () => false }), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /claude/);
    return true;
  });
});

test('default runner does not shell-interpret an arg-mode prompt (injection guard)', async () => {
  if (process.platform === 'win32') return; // POSIX-focused; Windows binary resolution differs
  const { existsSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const marker = path.join(os.tmpdir(), `instagui-injtest-${process.pid}-${process.hrtime.bigint()}.txt`);
  // `--` stops node's flag parsing so model + prompt become plain argv; the script echoes the last arg.
  const engine = {
    name: 'probe', kind: 'cli', binary: 'node',
    headlessArgs: ['-e', 'process.stdout.write(String(process.argv[process.argv.length - 1]))'],
    modelFlag: '--', model: 'x', promptVia: 'arg',
  } as const;
  // Put a shell-injection payload in the user prompt; if a shell ran it, `marker` would be created.
  const req2 = { model: 'x', system: 's', user: `hi"; touch ${marker}; echo "`, outputSchema: Demo };
  const complete = createCliComplete(engine as unknown as EngineDescriptor, { onPath: () => true });
  try { await complete(req2 as never); } catch { /* return value irrelevant; we assert the side effect */ }
  assert.equal(existsSync(marker), false, 'shell metacharacters in the prompt must NOT execute');
});
