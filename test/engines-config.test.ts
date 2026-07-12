import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEngineConfig } from '../src/shared/engines/config.js';
import { PreconditionError } from '../src/core/errors.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'instagui-cfg-'));
}

test('absent config file → empty engines, no default', () => {
  const cfg = loadEngineConfig(tmpDir());
  assert.deepEqual(cfg, { engines: {} });
});

test('valid config parses default + engines', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    default: 'kimi',
    engines: { kimi: { kind: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1', keyEnv: 'MOONSHOT_API_KEY', model: 'moonshot-v1-8k' } },
  }));
  const cfg = loadEngineConfig(dir);
  assert.equal(cfg.default, 'kimi');
  assert.equal(cfg.engines.kimi.kind, 'openai-compatible');
  assert.equal(cfg.engines.kimi.baseURL, 'https://api.moonshot.cn/v1');
});

test('invalid JSON → PreconditionError naming the file', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), '{ not json');
  assert.throws(() => loadEngineConfig(dir), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.equal(e.exitCode, 2);
    assert.match(e.message, /config\.json/);
    return true;
  });
});

test('bad shape (unknown kind) → PreconditionError', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ engines: { x: { kind: 'wat' } } }));
  assert.throws(() => loadEngineConfig(dir), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    return true;
  });
});

test('plaintext "key" on disk is rejected, pointing to keyEnv (no raw secret in a config file)', () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    engines: { openai: { kind: 'openai-compatible', baseURL: 'https://api.openai.com/v1', key: 'sk-secret' } },
  }));
  assert.throws(() => loadEngineConfig(dir), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.equal((e as PreconditionError).exitCode, 2);
    assert.match((e as Error).message, /keyEnv/);
    assert.doesNotMatch((e as Error).message, /sk-secret/); // never echo the secret back
    return true;
  });
});
