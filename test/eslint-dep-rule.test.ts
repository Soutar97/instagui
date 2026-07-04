import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

// AC: "When ESLint runs, the AD-2 dependency rule is enforced (a shared/ → core/ import
// fails lint)." We lint an in-memory shared/ file that imports core/ and assert the
// no-restricted-imports rule fires.
const eslint = new ESLint();

test('AD-2: a shared/ module importing core/ fails lint', async () => {
  const code = `import { Schema } from '../core/schema.js';\nexport const x: unknown = Schema;\n`;
  const [result] = await eslint.lintText(code, { filePath: 'src/shared/illegal.ts' });
  const violations = result!.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  assert.ok(
    violations.length >= 1,
    `expected an AD-2 no-restricted-imports error, got: ${JSON.stringify(result!.messages)}`,
  );
  assert.match(violations[0]!.message, /AD-2/);
});

test('AD-2: a core/ module importing shared/ is allowed', async () => {
  const code = `import { hasApiKey } from '../shared/config.js';\nexport const ok: boolean = hasApiKey();\n`;
  const [result] = await eslint.lintText(code, { filePath: 'src/core/legal.ts' });
  const violations = result!.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  assert.equal(violations.length, 0, 'core → shared must not be restricted');
});
