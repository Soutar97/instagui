// Story 3.3 — RunController lifecycle, unit-tested with a fake child (no real process):
// exactly one run in flight, stdout+stderr forwarded, exit reported, Stop kills, and a spawn
// error surfaces as stream text + a clean end rather than an unhandled throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RunController } from '../src/server/run.js';
import type { RunSink, RunResult } from '../src/server/run.js';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: (string | number)[] = [];
  kill(sig?: string | number): boolean {
    this.killed.push(sig ?? 'SIGTERM');
    return true;
  }
}

function collectingSink() {
  const out: string[] = [];
  let ended: RunResult | null = null;
  const sink: RunSink = { out: (c) => out.push(c), end: (r) => (ended = r) };
  return { sink, out, get ended() { return ended as RunResult | null; } };
}

function fakeSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  let last: FakeChild | null = null;
  const spawnFn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    last = new FakeChild();
    return last;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawnFn, calls, child: () => last! };
}

test('start spawns with the args array (no shell) and forwards stdout + stderr', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  const s = collectingSink();

  const outcome = c.start('mytool', ['-i', 'a b.mp4', 'out.mp4'], s.sink);
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(fs.calls[0], { cmd: 'mytool', args: ['-i', 'a b.mp4', 'out.mp4'] });

  fs.child().stdout.emit('data', Buffer.from('hello '));
  fs.child().stderr.emit('data', Buffer.from('warn'));
  assert.deepEqual(s.out, ['hello ', 'warn']);
});

test('exactly one run in flight: a second start is refused while running', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  c.start('t', [], collectingSink().sink);
  assert.equal(c.running, true);
  const second = c.start('t', [], collectingSink().sink);
  assert.equal(second.ok, false);
  assert.equal(fs.calls.length, 1); // no second spawn
});

test('close reports the exit code + signal and frees the controller for the next run', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  const s = collectingSink();
  c.start('t', [], s.sink);

  fs.child().emit('close', 0, null);
  assert.deepEqual(s.ended, { code: 0, signal: null });
  assert.equal(c.running, false);

  // A fresh run is now accepted.
  assert.deepEqual(c.start('t', [], collectingSink().sink), { ok: true });
});

test('stop kills the child (SIGTERM); returns false when nothing is running', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  assert.equal(c.stop(), false);

  c.start('t', [], collectingSink().sink);
  assert.equal(c.stop(), true);
  assert.deepEqual(fs.child().killed, ['SIGTERM']);
});

test('a non-zero exit is reported faithfully (visibly-distinct handled by the UI)', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  const s = collectingSink();
  c.start('t', [], s.sink);
  fs.child().emit('close', 1, null);
  assert.deepEqual(s.ended, { code: 1, signal: null });
});

test('ENOENT at run maps to the friendly "not installed or not on your PATH" message (tool named)', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  const s = collectingSink();
  c.start('ffmpeg', [], s.sink);

  const enoent = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  fs.child().emit('error', enoent);

  const text = s.out.join('');
  assert.match(text, /"ffmpeg" is not installed or not on your PATH/);
  assert.doesNotMatch(text, /spawn ffmpeg ENOENT/); // the raw Node error is not leaked
  assert.deepEqual(s.ended, { code: null, signal: null }); // clean end, not a throw
  assert.equal(c.running, false);
});

test('a non-ENOENT spawn error falls back to its message + a clean end', () => {
  const fs = fakeSpawn();
  const c = new RunController(fs.spawnFn);
  const s = collectingSink();
  c.start('mytool', [], s.sink);

  fs.child().emit('error', Object.assign(new Error('EACCES permission denied'), { code: 'EACCES' }));
  assert.match(s.out.join(''), /failed to run command: EACCES permission denied/);
  assert.deepEqual(s.ended, { code: null, signal: null });
});
