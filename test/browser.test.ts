// Story 3.1 — auto-open the browser. We assert the platform-correct command and that the URL
// is passed as a single argument (never shell-interpolated), using a fake spawn so no browser
// actually launches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  openCommand,
  openBrowser,
  isSshSession,
  sshTarget,
  sshHint,
  announceServing,
} from '../src/server/browser.js';

test('openCommand picks the right opener per platform, URL as a single arg', () => {
  const url = 'http://127.0.0.1:5177/';
  assert.deepEqual(openCommand(url, 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', url] });
  assert.deepEqual(openCommand(url, 'darwin'), { cmd: 'open', args: [url] });
  assert.deepEqual(openCommand(url, 'linux'), { cmd: 'xdg-open', args: [url] });
});

test('openBrowser spawns the opener (injected spawn), returns the command it used', () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    return child;
  }) as unknown as typeof import('node:child_process').spawn;

  const used = openBrowser('http://127.0.0.1:5177/', { platform: 'darwin', spawnFn: fakeSpawn });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { cmd: 'open', args: ['http://127.0.0.1:5177/'] });
  assert.deepEqual(used, { cmd: 'open', args: ['http://127.0.0.1:5177/'] });
});

test('openBrowser never throws when spawn fails (best-effort; URL is printed anyway)', () => {
  const throwingSpawn = (() => {
    throw new Error('no browser');
  }) as unknown as typeof import('node:child_process').spawn;
  assert.doesNotThrow(() => openBrowser('http://127.0.0.1:5177/', { platform: 'linux', spawnFn: throwingSpawn }));
});

// ── SSH-aware serving ─────────────────────────────────────────────────────────

test('isSshSession detects SSH_CONNECTION or SSH_TTY, false when absent/empty', () => {
  assert.equal(isSshSession({ SSH_CONNECTION: '10.0.0.2 51828 10.0.0.9 22' }), true);
  assert.equal(isSshSession({ SSH_TTY: '/dev/pts/3' }), true);
  assert.equal(isSshSession({}), false);
  // Empty/whitespace values are not a session.
  assert.equal(isSshSession({ SSH_CONNECTION: '', SSH_TTY: '  ' }), false);
});

test('sshTarget derives host from SSH_CONNECTION field 3, placeholders otherwise', () => {
  // "<client-ip> <client-port> <server-ip> <server-port>" — field 3 is the host to ssh to.
  assert.deepEqual(sshTarget({ SSH_CONNECTION: '10.0.0.2 51828 203.0.113.7 22' }), {
    user: '<user>',
    host: '203.0.113.7',
  });
  // No SSH_CONNECTION → both placeholders (never a wrong-but-plausible value).
  assert.deepEqual(sshTarget({}), { user: '<user>', host: '<host>' });
  // Malformed SSH_CONNECTION (too few fields) → host placeholder.
  assert.deepEqual(sshTarget({ SSH_CONNECTION: '10.0.0.2 51828' }), { user: '<user>', host: '<host>' });
});

test('sshHint formats the port-forward command with the actual bound port', () => {
  const hint = sshHint(5177, { SSH_CONNECTION: '10.0.0.2 51828 203.0.113.7 22' });
  assert.match(hint, /Running over SSH\. On your local machine run:/);
  assert.match(hint, /ssh -L 5177:127\.0\.0\.1:5177 <user>@203\.0\.113\.7/);
  assert.match(hint, /then open http:\/\/127\.0\.0\.1:5177/);

  // A non-default (fallback) port is threaded through verbatim, both sides of the forward.
  const alt = sshHint(49213, {});
  assert.match(alt, /ssh -L 49213:127\.0\.0\.1:49213 <user>@<host>/);
  assert.match(alt, /then open http:\/\/127\.0\.0\.1:49213/);
});

test('announceServing under SSH returns the hint and spawns NO browser', () => {
  let spawnCalls = 0;
  const spyingSpawn = (() => {
    spawnCalls++;
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    return child;
  }) as unknown as typeof import('node:child_process').spawn;

  const out = announceServing('http://127.0.0.1:5177/', 5177, {
    env: { SSH_CONNECTION: '10.0.0.2 51828 203.0.113.7 22' },
    // Even with --no-open unset, SSH must not open a browser.
    noOpen: false,
    spawnFn: spyingSpawn,
  });
  assert.equal(spawnCalls, 0, 'no browser spawn may be attempted under SSH');
  assert.equal(out.action, 'ssh-hint');
  assert.ok(out.action === 'ssh-hint' && out.hint.includes('ssh -L 5177:127.0.0.1:5177'));
});

test('announceServing off SSH is unchanged: opens the browser, or suppresses with --no-open', () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    return child;
  }) as unknown as typeof import('node:child_process').spawn;

  // No SSH, no --no-open → auto-open as before.
  const opened = announceServing('http://127.0.0.1:5177/', 5177, {
    env: {},
    platform: 'linux',
    spawnFn: fakeSpawn,
  });
  assert.equal(opened.action, 'opened');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { cmd: 'xdg-open', args: ['http://127.0.0.1:5177/'] });

  // No SSH, --no-open → nothing spawned.
  const suppressed = announceServing('http://127.0.0.1:5177/', 5177, {
    env: {},
    noOpen: true,
    spawnFn: fakeSpawn,
  });
  assert.equal(suppressed.action, 'suppressed');
  assert.equal(calls.length, 1, '--no-open must not spawn a browser');
});
