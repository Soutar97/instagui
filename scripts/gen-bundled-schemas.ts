// Story 2.3 — regenerate the bundled demo schemas in schemas/.
//
// This script OWNS the bundled schemas (the readiness finding: nothing else generates
// them). It extracts a Schema from each demo tool's captured --help fixture and writes
// schemas/<tool>.json — the read-only keyless fallback tier.
//
// Run keyless with the dev engine (no ANTHROPIC_API_KEY needed):
//   INSTAGUI_ENGINE=claude-code npx tsx scripts/gen-bundled-schemas.ts
// Or against the real SDK/haiku path (pre-publish gate — see schemas/README.md):
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/gen-bundled-schemas.ts
//
// A hallucination guard runs before anything is written: if the model invents a flag that
// isn't in the fixture, generation FAILS for that tool rather than shipping a bad schema.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSchema } from '../src/core/extract.js';
import { findHallucinatedFlags, goldenCheck, type RequiredOption } from '../src/core/golden.js';
import { activeEngineName } from '../src/shared/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const fixtures = path.join(root, 'test', 'fixtures');
const outDir = path.join(root, 'schemas');

interface Demo {
  tool: string;
  fixture: string;
  /** A few load-bearing options the demo relies on; a sanity floor, not exhaustive. */
  golden: RequiredOption[];
}

const DEMOS: Demo[] = [
  {
    tool: 'ffmpeg',
    fixture: 'ffmpeg-help.txt',
    golden: [
      { flag: '-i', type: 'path' },
      { flag: '-c', type: 'string' },
    ],
  },
  {
    tool: 'yt-dlp',
    fixture: 'yt-dlp-help.txt',
    golden: [
      { flag: '-f', type: 'string' },
      { flag: '-o', type: 'string' },
      { flag: '-x', type: 'boolean' },
    ],
  },
  {
    tool: 'pandoc',
    fixture: 'pandoc-help.txt',
    golden: [
      { flag: '-o', type: 'path' },
      { flag: '-f', type: 'string' },
      { flag: '-t', type: 'string' },
    ],
  },
  // Growth item #1 — additional bundled tools (curl, jq, tar, magick, zip). rsync was
  // requested too but has no clean Windows binary to capture an authentic --help fixture
  // from, so it is deliberately not bundled (skip-with-a-note, never shipped broken).
  {
    tool: 'curl',
    fixture: 'curl-help.txt',
    golden: [
      { flag: '-o', type: 'path' },
      { flag: '-L', type: 'boolean' },
      { flag: '-d', type: 'string' },
    ],
  },
  {
    tool: 'jq',
    fixture: 'jq-help.txt',
    golden: [
      { flag: '-r', type: 'boolean' },
      { flag: '-s', type: 'boolean' },
      { flag: '-c', type: 'boolean' },
    ],
  },
  {
    tool: 'tar',
    fixture: 'tar-help.txt',
    golden: [
      { flag: '-c', type: 'boolean' },
      { flag: '-x', type: 'boolean' },
      { flag: '-f', type: 'path' },
    ],
  },
  {
    tool: 'magick',
    fixture: 'magick-help.txt',
    golden: [
      { flag: '-resize', type: 'string' },
      { flag: '-quality', type: 'number' },
      { flag: '-strip', type: 'boolean' },
    ],
  },
  {
    tool: 'zip',
    fixture: 'zip-help.txt',
    golden: [
      { flag: '-r', type: 'boolean' },
      { flag: '-e', type: 'boolean' },
      { flag: '-m', type: 'boolean' },
    ],
  },
];

async function main(): Promise<number> {
  mkdirSync(outDir, { recursive: true });
  console.error(`gen-bundled-schemas: engine=${activeEngineName()}`);

  // Optional tool filter: `gen-bundled-schemas.ts curl jq` regenerates only those tools,
  // leaving the other committed schemas untouched. No args → regenerate every bundled tool.
  const only = new Set(process.argv.slice(2));
  const selected = only.size > 0 ? DEMOS.filter((d) => only.has(d.tool)) : DEMOS;
  if (only.size > 0) console.error(`gen-bundled-schemas: filter=${[...only].join(', ')}`);

  let failures = 0;
  for (const demo of selected) {
    const helpText = readFileSync(path.join(fixtures, demo.fixture), 'utf8');
    console.error(`\n[${demo.tool}] extracting from ${demo.fixture} ...`);
    try {
      const { schema, attempts } = await extractSchema(helpText, demo.tool);

      const hallucinated = findHallucinatedFlags(schema, helpText);
      if (hallucinated.length > 0) {
        console.error(`[${demo.tool}] FAILED — hallucinated flags: ${hallucinated.join(', ')}`);
        failures++;
        continue;
      }
      const golden = goldenCheck(schema, demo.golden);
      if (!golden.ok) {
        console.error(
          `[${demo.tool}] FAILED golden check — missing: ${golden.missing.join(', ') || 'none'}; ` +
            `type mismatches: ${golden.typeMismatches.join('; ') || 'none'}`,
        );
        failures++;
        continue;
      }

      const outFile = path.join(outDir, `${demo.tool}.json`);
      writeFileSync(outFile, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
      console.error(
        `[${demo.tool}] OK — ${schema.options.length} options, ${schema.positionals.length} positionals ` +
          `(${attempts} attempt(s)) → ${path.relative(root, outFile)}`,
      );
    } catch (e) {
      console.error(`[${demo.tool}] ERROR — ${(e as Error).message}`);
      failures++;
    }
  }

  console.error(`\ngen-bundled-schemas: ${selected.length - failures}/${selected.length} generated.`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
