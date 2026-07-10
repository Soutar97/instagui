#!/usr/bin/env node
// cli/index.ts — `instagui <tool>` resolves a validated Schema and serves it as a local web Form
// (Epic 3). `--print` keeps the Epic 1/2 behaviour of emitting the Schema JSON and exiting.
//
// Resolution precedence (Epic 2): --schema override > user cache (~/.instagui) > bundled
// schemas > fresh extraction. Only the extraction tier captures help or calls the AI, and
// only it needs an API key — so the demo tools, a cache hit, or --schema never prompt for
// one. A fresh extraction is written back to the user cache so the next run is free.
//
// Within extraction, help source precedence is --help-file > piped stdin > live capture.
// Maps core errors to the exit-code contract (0 ok · 2 known precondition · 1 unexpected).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { extractSchema } from '../core/extract.js';
import { captureHelp } from '../core/capture.js';
import { resolveSchema } from '../core/resolve.js';
import { readCache, writeCache } from '../core/cache.js';
import { readBundled } from '../core/bundled.js';
import { loadOverrideSchema } from '../core/override.js';
import { PreconditionError } from '../core/errors.js';
import { resolveEngineSelection } from '../shared/engine.js';
import { startServer } from '../server/server.js';
import { openBrowser } from '../server/browser.js';

/** Our own version, read from the shipped package.json (works from both dist/ and src/ — the
 *  relative path to the package root is the same). We parse everyone else's help text; our own
 *  --version and --help should be exemplary. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USAGE = `instagui <tool> — turn a CLI tool into a local web Form. Resolves a validated option
Schema, serves it as a single-page Form, and (on Run) executes the command and streams output.

Usage:
  instagui <tool>                        resolve <tool>'s Schema and serve the Form (auto-opens browser)
  instagui <tool> --print                resolve and print the Schema JSON instead of serving
  instagui <tool> --schema <path>        use a hand-supplied Schema file (no capture, no AI)
  instagui <tool> --refresh              ignore cache + bundled and re-extract fresh
  instagui <tool> --help-file <path>     extract from a captured help-text file
  <tool> --help | instagui <tool>        or pipe help text on stdin

Resolution precedence: --schema > user cache (~/.instagui) > bundled schemas > fresh extraction.
The demo tools (ffmpeg, yt-dlp, pandoc) ship bundled Schemas, so they work with no API key.

Options:
  --print              print the resolved Schema JSON to stdout and exit (no server)
  --port <n>           preferred port for the Form server (default 5177; falls back if busy)
  --no-open            do not auto-open the browser (still prints the URL)
  --schema <path>      use this Schema file directly (top precedence)
  --refresh            bypass cache + bundled and re-extract, overwriting the cache
  --help-file <path>   read help text from a file instead of capturing (extraction only)
  --capture            force live capture (ignore piped stdin)
  --model <id>         extraction model (default: claude-haiku-4-5)
  --engine <name>      AI engine: anthropic | openai | google | ollama | claude | codex | gemini
                       | any engine in ~/.instagui/config.json. Default: auto-detect.
  --engines            list available engines and whether each is ready, then exit
  -v, --version        print the instagui version and exit
  -h, --help           show this message

Examples:
  instagui ffmpeg                        open a Form for ffmpeg (bundled — no key needed)
  instagui yt-dlp --no-open              serve without launching a browser; print the URL
  instagui mytool --print                just resolve and print the Schema as JSON
  instagui mytool --schema ./mytool.json use a hand-tuned Schema, skip capture + AI

The server binds 127.0.0.1 only. Extraction uses your selected AI engine (--engine / INSTAGUI_ENGINE /
~/.instagui/config.json / auto-detect). Run \`instagui --engines\` to see options.
Exit codes: 0 ok · 2 known failure · 1 unexpected.`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Resolve help text by precedence: --help-file > piped stdin > live capture.
 *  `--capture` forces live capture past the stdin heuristic. */
async function resolveHelpText(
  tool: string,
  helpFile: string | undefined,
  forceCapture: boolean,
): Promise<{ helpText: string; source: string }> {
  if (helpFile) {
    return { helpText: readFileSync(helpFile, 'utf8'), source: `file:${helpFile}` };
  }
  if (!forceCapture && !process.stdin.isTTY) {
    return { helpText: await readStdin(), source: 'stdin' };
  }
  const { helpText, method } = await captureHelp(tool);
  return { helpText, source: `capture:${method}` };
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      schema: { type: 'string' },
      refresh: { type: 'boolean' },
      'help-file': { type: 'string' },
      capture: { type: 'boolean' },
      model: { type: 'string' },
      print: { type: 'boolean' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      engine: { type: 'string' },
      engines: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.version) {
    console.log(readVersion());
    return 0;
  }

  if (values.engines) {
    const { buildRegistry, describeEngines } = await import('../shared/engines/registry.js');
    const { loadEngineConfig } = await import('../shared/engines/config.js');
    const rows = describeEngines(buildRegistry(loadEngineConfig()));
    console.log('Available instagui AI engines (● = ready now):\n');
    for (const r of rows) {
      console.log(`  ${r.available ? '●' : '○'} ${r.name.padEnd(10)} ${r.kind.padEnd(18)} ${r.detail}`);
    }
    console.log('\nSelect with --engine <name>, INSTAGUI_ENGINE=<name>, or a "default" in ~/.instagui/config.json.');
    return 0;
  }

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const tool = positionals[0]!;

  // The extraction tier: capture help, resolve an AI engine, and run it. Only reached when
  // override/cache/bundled all miss (or --refresh is set), so engine readiness (a key, a
  // logged-in CLI, etc.) is only required exactly when it is genuinely needed.
  const extract = async () => {
    const { helpText, source } = await resolveHelpText(tool, values['help-file'], values.capture ?? false);
    console.error(`instagui: help from ${source}`);

    // captureHelp throws on empty/no-help; only file/stdin can reach here empty.
    if (helpText.trim().length === 0) {
      throw new PreconditionError(
        `No help text provided for "${tool}" (${source}). Pass --help-file <path> or pipe the tool's help output on stdin.`,
      );
    }

    // Resolve the AI engine (throws a friendly PreconditionError if none is usable).
    const selection = resolveEngineSelection({ flag: values.engine });
    console.error(`instagui: extracting via ${selection.engine} (${selection.reason})`);

    const { schema } = await extractSchema(helpText, tool, { model: values.model, complete: selection.complete });
    return schema;
  };

  const result = await resolveSchema(
    { tool, schemaFile: values.schema, refresh: values.refresh ?? false },
    {
      loadOverride: loadOverrideSchema,
      readCache: (t) => readCache(t),
      readBundled: (t) => readBundled(t),
      extract,
      writeCache: (t, s) => writeCache(t, s),
    },
  );

  console.error(`instagui: schema from ${result.source}`);
  if (result.cachedTo) console.error(`instagui: cached to ${result.cachedTo}`);

  // --print keeps the Epic 1/2 behaviour: emit the Schema JSON and exit (no server).
  if (values.print) {
    console.log(JSON.stringify(result.schema, null, 2));
    return 0;
  }

  // Default (Epic 3): serve the Schema as a Form and hold the process open until Ctrl-C.
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new PreconditionError(`Invalid --port "${values.port}": expected an integer 0–65535.`);
    }
  }

  const server = await startServer({ schema: result.schema, port });
  console.error(`instagui: serving ${tool} form at ${server.url}`);
  console.log(server.url); // the URL on stdout so it's scriptable / copyable
  if (!values['no-open']) openBrowser(server.url);
  console.error('instagui: press Ctrl-C to stop.');

  // Hold the process open; shut the server down cleanly on Ctrl-C.
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.error('\ninstagui: shutting down.');
      server.close().finally(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof PreconditionError) {
      console.error(`instagui: ${err.message}`);
      process.exit(err.exitCode);
    }
    // Unexpected: stack to stderr only, exit 1.
    console.error('instagui: unexpected error');
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
