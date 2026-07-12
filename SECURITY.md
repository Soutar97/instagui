# Security Policy

instagui is a **local, single-user tool**: it reads a CLI tool's `--help`, renders a
form on `127.0.0.1`, and runs the command you compose. This document states the threat
model it is built around, what versions receive fixes, and how to report a vulnerability
privately.

## Supported versions

Only the latest minor release line receives security fixes. Older lines are
end-of-life — upgrade to the latest published version.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Threat model

Be clear-eyed about what instagui does and the boundaries it enforces:

- **It runs commands you compose.** The whole point is to execute a real CLI with the
  arguments you set in the form. Treat the form like your own terminal — don't run
  something you wouldn't type. instagui does not sandbox the tool it launches.
- **The exact command is always shown before you Run it.** No hidden arguments; the
  preview is generated from the *same* argument array that Run executes, so what you see
  is what runs.
- **Arguments are passed as an array to `spawn`, never concatenated into a shell**
  (`shell: false` everywhere). A value containing spaces, quotes, `;`, or `&&` is passed
  verbatim as a single argument — there is no shell to interpret it, so form input can't
  inject extra commands. This holds even for the extraction prompt, which may ride in
  argv.
- **The server binds `127.0.0.1` only.** It is never bound to `0.0.0.0` and is not
  reachable from your network.
- **State-changing requests fail closed.** `POST /run` and `POST /stop` require an
  `Origin` header that matches the bound `host:port`; a missing or foreign origin is
  rejected with 403 (CSRF protection). Read-only routes are exempt. Exactly one run at a
  time, and closing the tab (dropping the stream) kills the child process — no orphans.
- **Your API key is never logged, echoed, or embedded in any served page or error body.**
  `--engines` prints key *names* and readiness only, never a value. No raw key is read
  from or written to disk — keys come only from the environment via `keyEnv`. The only
  data that leaves your machine is the tool's help text, sent to your selected AI engine
  for extraction (nowhere, for a local `ollama` engine). **No telemetry.**

### Out of scope

instagui is not a multi-user service, a hosted runner, or a sandbox. Running it exposes a
local execution surface to whoever can already reach `127.0.0.1` on your machine and pass
the Origin check (i.e. a browser you control). Do not expose the port to a network, and do
not run instagui on a shared/untrusted host as a way to gate access — it is not designed
for that.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Soutar97/instagui/security) of the
   repository.
2. Click **Report a vulnerability** to open a private advisory (GitHub → *Report a
   vulnerability* / Security Advisories).

This opens a private channel visible only to the maintainers. Please include:

- affected version(s) and platform,
- a description of the issue and its impact,
- reproduction steps or a proof of concept, and
- any suggested remediation if you have one.

You can expect an initial acknowledgement within a few days. Once a fix is available it
ships in the latest supported minor line, and we'll credit you in the advisory unless you
prefer to remain anonymous.
