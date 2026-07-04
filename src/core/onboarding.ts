// Story 2.4 — friendly onboarding when a key is genuinely needed. This error is thrown ONLY
// on the extraction tier, after override/cache/bundled have all missed: a user who can be
// served without a key (demo tools, a cache hit, or --schema) never sees it.
//
// The message is intentionally kind and actionable — what to get, where, and how to set it
// on both Windows and POSIX — never a stack trace or a silent failure.
import { PreconditionError } from './errors.js';
import { API_KEY_ENV } from '../shared/config.js';

/** The one-time, key-needed onboarding error (exit 2). Never prints or reads the key. */
export function apiKeyOnboardingError(): PreconditionError {
  return new PreconditionError(
    `This tool needs a one-time AI extraction, and no schema was found in your cache or the ` +
      `bundled demo schemas — so an Anthropic API key is required.\n` +
      `  1. Get a key:  https://console.anthropic.com/settings/keys\n` +
      `  2. Set it in your shell, then re-run:\n` +
      `       PowerShell:  $env:${API_KEY_ENV}="sk-ant-..."\n` +
      `       POSIX:       export ${API_KEY_ENV}="sk-ant-..."\n` +
      `Tip: the bundled demo tools (ffmpeg, yt-dlp, pandoc) work with no key at all.`,
  );
}
