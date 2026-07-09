import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistry, resolveEngine, autodetect, selectEngine, describeEngines,
} from '../src/shared/engines/registry.js';
import { PreconditionError } from '../src/core/errors.js';
import type { EngineConfig } from '../src/shared/engines/config.js';

const emptyCfg: EngineConfig = { engines: {} };

test('buildRegistry merges user engines over built-ins', () => {
  const reg = buildRegistry({ engines: { kimi: { kind: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1', keyEnv: 'MOONSHOT_API_KEY' }, anthropic: { kind: 'anthropic', model: 'claude-opus-4-8' } } });
  assert.equal(reg.kimi.name, 'kimi');
  assert.equal(reg.anthropic.model, 'claude-opus-4-8'); // override wins
  assert.ok(reg.claude); // built-in still present
});

test('resolveEngine throws a listing error on an unknown name', () => {
  const reg = buildRegistry(emptyCfg);
  assert.throws(() => resolveEngine('nope', reg), (e: unknown) => {
    assert.ok(e instanceof PreconditionError);
    assert.match(e.message, /nope/);
    assert.match(e.message, /anthropic/); // lists available
    return true;
  });
});

test('autodetect prefers a set API key (anthropic) over an installed CLI', () => {
  const reg = buildRegistry(emptyCfg);
  const got = autodetect(reg, { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => true });
  assert.equal(got?.engine.name, 'anthropic');
  assert.match(got!.reason, /ANTHROPIC_API_KEY/);
});

test('autodetect falls back to a CLI when no API key is set', () => {
  const reg = buildRegistry(emptyCfg);
  const got = autodetect(reg, { env: {}, onPath: (b) => b === 'claude' });
  assert.equal(got?.engine.name, 'claude');
});

test('autodetect returns null when nothing is available', () => {
  const reg = buildRegistry(emptyCfg);
  assert.equal(autodetect(reg, { env: {}, onPath: () => false }), null);
});

test('selectEngine precedence: flag > env > default > autodetect', () => {
  const reg = { config: { default: 'openai', engines: {} } as EngineConfig };
  const deps = { env: { ANTHROPIC_API_KEY: 'sk' }, onPath: () => true };
  assert.equal(selectEngine({ flag: 'ollama', config: reg.config }, deps).engine.name, 'ollama');
  assert.equal(selectEngine({ envName: 'google', config: reg.config }, deps).engine.name, 'google');
  assert.equal(selectEngine({ config: reg.config }, deps).engine.name, 'openai'); // config default
  assert.equal(selectEngine({ config: { engines: {} } }, deps).engine.name, 'anthropic'); // autodetect
});

test('selectEngine aliases INSTAGUI_ENGINE=claude-code to the claude engine', () => {
  const got = selectEngine({ envName: 'claude-code', config: { engines: {} } }, { env: {}, onPath: () => true });
  assert.equal(got.engine.name, 'claude');
});

test('selectEngine with nothing available throws the onboarding error', () => {
  assert.throws(() => selectEngine({ config: { engines: {} } }, { env: {}, onPath: () => false }), (e) => e instanceof PreconditionError);
});

test('describeEngines reports availability per engine', () => {
  const reg = buildRegistry(emptyCfg);
  const rows = describeEngines(reg, { env: { OPENAI_API_KEY: 'x' }, onPath: (b) => b === 'gemini' });
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.openai.available, true);
  assert.equal(byName.gemini.available, true);
  assert.equal(byName.anthropic.available, false);
});
