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

// ── SSH-aware serving ─────────────────────────────────────────────────────────
// Under an SSH session the "default browser" is on the *remote* box (or absent), so
// auto-opening is useless or actively wrong. Instead we detect the session and print a
// copy-paste port-forward hint so the user can reach the 127.0.0.1-bound Form from their
// own machine. Detection + formatting are pure so they can be unit-tested with a fake env.

type EnvLike = Record<string, string | undefined>;

/** True when we appear to be inside an SSH session. OpenSSH sets SSH_CONNECTION for every
 *  session and SSH_TTY when a tty is allocated; either present (and non-empty) is enough. */
export function isSshSession(env: EnvLike = process.env): boolean {
  const has = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0;
  return has(env.SSH_CONNECTION) || has(env.SSH_TTY);
}

/**
 * Derive the `<user>@<host>` for the reverse-tunnel command. SSH_CONNECTION is
 * "<client-ip> <client-port> <server-ip> <server-port>" — the *server* IP (field 3) is the
 * address the client connected to, i.e. the right host for `ssh …@<host>`. SSH_CONNECTION
 * carries no username, so `user` falls back to a placeholder. Anything undiscoverable is a
 * literal placeholder the user can edit, never a wrong-but-plausible value.
 */
export function sshTarget(env: EnvLike = process.env): { user: string; host: string } {
  let host = '<host>';
  const conn = env.SSH_CONNECTION;
  if (typeof conn === 'string') {
    const serverIp = conn.trim().split(/\s+/)[2];
    if (serverIp && serverIp.length > 0) host = serverIp;
  }
  return { user: '<user>', host };
}

/**
 * The multi-line, copy-ready SSH hint printed after the listening line (only when
 * isSshSession()). The middle line is the exact command to paste on the *local* machine to
 * forward `port` to the remote 127.0.0.1:`port`, then the local URL to open.
 */
export function sshHint(port: number, env: EnvLike = process.env): string {
  const { user, host } = sshTarget(env);
  return [
    'Running over SSH. On your local machine run:',
    `  ssh -L ${port}:127.0.0.1:${port} ${user}@${host}`,
    `then open http://127.0.0.1:${port}`,
  ].join('\n');
}

export interface AnnounceServingDeps {
  env?: EnvLike;
  /** --no-open: suppress the auto-open (non-SSH path only; SSH never auto-opens). */
  noOpen?: boolean;
  platform?: NodeJS.Platform;
  spawnFn?: SpawnLike;
}

export type ServeAnnouncement =
  | { action: 'ssh-hint'; hint: string }
  | { action: 'opened' }
  | { action: 'suppressed' };

/**
 * Single decision point for what to do after the server is listening:
 *   SSH session      → never open a browser; return the port-forward hint to print.
 *   --no-open        → open nothing.
 *   otherwise        → best-effort auto-open in the default browser.
 * The SSH check wins over --no-open (both end in "no browser"), so we short-circuit first and
 * a browser is never spawned under SSH. Returns a description of the action taken.
 */
export function announceServing(
  url: string,
  port: number,
  deps: AnnounceServingDeps = {},
): ServeAnnouncement {
  const env = deps.env ?? process.env;
  if (isSshSession(env)) {
    return { action: 'ssh-hint', hint: sshHint(port, env) };
  }
  if (deps.noOpen) return { action: 'suppressed' };
  openBrowser(url, { platform: deps.platform, spawnFn: deps.spawnFn });
  return { action: 'opened' };
}
