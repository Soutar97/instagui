// Story 2.1 — the user schema cache in ~/.instagui. A successful extraction is written here,
// keyed by tool name, so repeat launches load instantly with zero capture and zero API
// call. This is the WRITE target of the resolution chain; the packaged schemas/ dir
// (Story 2.3) is a read-only fallback and is never written here.
//
// A corrupt or stale cache file must never crash a launch: readCache returns null on any
// unreadable/invalid file so the resolver falls through to bundled/extraction.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { instaguiDir } from '../shared/config.js';
import { readSchemaFile } from './schema-file.js';
import type { Schema } from './schema.js';

/** Reduce a tool name to a filesystem-safe cache key. Keeps word chars, dot and dash
 *  (covers "ffmpeg", "yt-dlp", "pandoc"); collapses anything else (path separators, etc.)
 *  to "_" so a tool name can never escape the cache dir. */
export function toolKey(tool: string): string {
  return tool.replace(/[^\w.-]/g, '_');
}

/** Absolute path of the cache entry for `tool`. `dir` is injectable for tests. */
export function cachePath(tool: string, dir: string = instaguiDir()): string {
  return path.join(dir, `${toolKey(tool)}.json`);
}

/**
 * Load a cached Schema for `tool`, or null if there is no usable cache entry (absent,
 * unreadable, non-JSON, or failing Schema.parse). Null means "cache miss" — the caller
 * falls through to the next resolution tier rather than crashing.
 */
export function readCache(tool: string, dir: string = instaguiDir()): Schema | null {
  const result = readSchemaFile(cachePath(tool, dir));
  return result.ok ? result.schema : null;
}

/**
 * Persist a validated Schema to the user cache, creating ~/.instagui if needed. Returns the
 * path written. Overwrites any existing entry (this is how --refresh re-caches).
 */
export function writeCache(tool: string, schema: Schema, dir: string = instaguiDir()): string {
  mkdirSync(dir, { recursive: true });
  const file = cachePath(tool, dir);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  return file;
}
