// server/browser.ts — auto-open the served Form in the default browser (AC 3.1). The URL is
// always printed by the CLI too, so this is a convenience: a failure here is non-fatal.
//
// spawn is injected so tests can assert the platform-correct command WITHOUT launching a
// browser. Uses spawn with an args array (never a shell string) even for the opener.
import { spawn } from 'node:child_process';

export type SpawnLike = typeof spawn;

export interface OpenCommand {
  cmd: string;
  args: string[];
}

/**
 * The platform-appropriate command to open `url` in the default browser.
 *   win32 → cmd /c start "" <url>   (empty title arg so a quoted URL isn't taken as the title)
 *   darwin → open <url>
 *   else   → xdg-open <url>
 * The URL is passed as a single argument — no shell interpolation.
 */
export function openCommand(url: string, platform: NodeJS.Platform): OpenCommand {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

export interface OpenBrowserDeps {
  platform?: NodeJS.Platform;
  spawnFn?: SpawnLike;
}

/** Best-effort: launch the browser, swallowing any failure (the printed URL is the fallback). */
export function openBrowser(url: string, deps: OpenBrowserDeps = {}): OpenCommand {
  const platform = deps.platform ?? process.platform;
  const spawnFn = deps.spawnFn ?? spawn;
  const { cmd, args } = openCommand(url, platform);
  try {
    const child = spawnFn(cmd, args, { stdio: 'ignore', detached: false, windowsHide: true });
    child.on('error', () => {
      /* browser open is best-effort; the URL was printed */
    });
    child.unref?.();
  } catch {
    /* ignore — non-fatal */
  }
  return { cmd, args };
}
