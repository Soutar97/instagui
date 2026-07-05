// AD-3 — shared/ is instagui-agnostic. Config is limited to the two things the whole
// program shares: the API key and the on-disk data dir. No Tool/Schema/Form concepts.
import os from 'node:os';
import path from 'node:path';

/** The env var carrying the Anthropic key. Never logged or echoed. */
export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

/** True when a key is present in the environment. Does not read or return its value. */
export function hasApiKey(): boolean {
  const v = process.env[API_KEY_ENV];
  return typeof v === 'string' && v.trim().length > 0;
}

/** The per-user data directory (`~/.instagui`). Used by the cache in Epic 2; defined here
 *  so the boundary lives in one place. */
export function instaguiDir(): string {
  return path.join(os.homedir(), '.instagui');
}
