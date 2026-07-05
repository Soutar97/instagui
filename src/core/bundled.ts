// Story 2.3 — bundled demo schemas. The published package ships a read-only `schemas/`
// dir so the demo tools (ffmpeg, yt-dlp, pandoc, …) work with NO API key and NO capture:
// the `npx instagui ffmpeg` magic isn't gated behind getting a key.
//
// This tier is READ-ONLY. It sits below the user cache in precedence (cache wins), and a
// fresh extraction is never written here — it goes to ~/.instagui (see core/cache.ts). So a
// user who re-extracts a bundled tool gets their own entry going forward while the shipped
// fallback stays pristine.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSchemaFile } from './schema-file.js';
import { toolKey } from './cache.js';
import type { Schema } from './schema.js';

/** The packaged schemas/ directory, resolved relative to this module so it works both from
 *  source (src/core/ → ../../schemas) and from the published tarball (dist/core/ →
 *  ../../schemas). Injectable in tests. */
export function bundledDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'schemas');
}

/**
 * Load the bundled Schema for `tool`, or null if the tool isn't bundled or the shipped file
 * is somehow unreadable/invalid (fall through to extraction — never crash a launch). Uses
 * the same tool-name keying as the user cache so a bundled file matches a cache lookup.
 */
export function readBundled(tool: string, dir: string = bundledDir()): Schema | null {
  const result = readSchemaFile(path.join(dir, `${toolKey(tool)}.json`));
  return result.ok ? result.schema : null;
}
