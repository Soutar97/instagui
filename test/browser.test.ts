// Story 3.1 — auto-open the browser. We assert the platform-correct command and that the URL
// is passed as a single argument (never shell-interpolated), using a fake spawn so no browser
// actually launches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openCommand, openBrowser } from '../src/server/browser.js';

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
