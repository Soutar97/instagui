# guiup

**Any CLI. Instant GUI. One command.**

Turn any command-line tool into a clean local web form — no config, no code changes to the tool.

<!-- TODO(pre-launch): record and drop the money-demo GIF here.
     ~10s: `npx guiup ffmpeg` → browser opens → fill a couple fields → Run → output streams.
     Save as docs/demo.gif and it renders below. -->
![guiup demo — npx guiup ffmpeg opens a web form, click Run, output streams](docs/demo.gif)

```sh
npx guiup ffmpeg
```

That's it. guiup reads the tool's `--help`, turns it into a web form, opens your browser, and
(when you click **Run**) executes the command locally and streams the output back — while always
showing you the exact command it will run, so it teaches you the CLI instead of hiding it.

---

## Why

Thousands of powerful CLIs (ffmpeg, pandoc, yt-dlp, curl, imagemagick…) are unfriendly to anyone
who doesn't live in a terminal — and even experts re-read man pages to recall flag syntax. Tools
like Gooey require the tool's *author* to change their code. guiup needs nothing from the tool: it
parses the tool's own `--help` text with AI into a structured schema and renders that as a form.

## Quick start

The three demo tools ship with **bundled schemas**, so they work instantly with **no API key**:

```sh
npx guiup ffmpeg      # video/audio transcoding
npx guiup yt-dlp      # download media
npx guiup pandoc      # convert documents
```

For any *other* tool, guiup extracts the schema on first run using the Claude API (see
[How it stays free](#how-it-stays-free)):

```sh
export ANTHROPIC_API_KEY=sk-ant-...    # POSIX
$env:ANTHROPIC_API_KEY="sk-ant-..."    # Windows / PowerShell
npx guiup curl
```

Get a key at <https://console.anthropic.com>. The first extraction is cached, so every launch
after that is instant and free.

## How it works

1. **Capture** — run `<tool> --help` (falling back to `-h`, `help`, then the man page), reading
   both stdout and stderr, under a timeout and size cap so a misbehaving tool can't hang the launch.
2. **Extract** — send the help text to the Claude API (`claude-haiku-4-5`) and get back a validated
   JSON schema of the tool's options (name, flag, type, description, enum values, required, grouping)
   plus positional arguments. Invalid output is retried once, then fails clearly.
3. **Serve** — render the schema as a single-page form on `http://127.0.0.1`, grouped, with the
   right control per type (checkbox / dropdown / number / text).
4. **Preview** — show the exact command as you edit the form, one-click copyable.
5. **Run** — execute the command with `spawn` (arguments array, never a shell string) and stream
   stdout/stderr live into the page until it exits.

## How it stays free

guiup resolves a schema in this order, and only the last step costs an API call:

| Precedence | Source | Needs a key? |
| --- | --- | --- |
| 1 | `--schema <file>` override you supply | no |
| 2 | Your cache in `~/.guiup/` (written on first extraction) | no |
| 3 | Bundled schemas shipped with the package (ffmpeg, yt-dlp, pandoc) | no |
| 4 | Fresh extraction via the Claude API | **yes** |

So the demo tools are free forever, any tool you've used once is free forever after, and you only
need a key the first time you point guiup at a brand-new tool. A friendly message tells you exactly
what to do if a key is needed and missing — you're never dropped into a stack trace.

- `--refresh` re-extracts and overwrites your cache entry.
- `--schema ./mytool.json` uses a hand-tuned schema and skips capture **and** the AI entirely.

## Usage

```
guiup <tool>                 resolve <tool>'s Schema and serve the Form (auto-opens the browser)
guiup <tool> --print         resolve and print the Schema JSON instead of serving
guiup <tool> --schema <path> use a hand-supplied Schema file (no capture, no AI)
guiup <tool> --refresh       ignore cache + bundled and re-extract fresh
guiup <tool> --help-file <p> extract from a captured help-text file
<tool> --help | guiup <tool> or pipe help text on stdin

  --port <n>     preferred port for the Form server (default 5177; falls back if busy)
  --no-open      do not auto-open the browser (still prints the URL)
  --model <id>   extraction model (default: claude-haiku-4-5)
  -v, --version  print the guiup version
  -h, --help     show help
```

## Security / threat model

guiup is a **local, single-user tool**. Be clear-eyed about what it does:

- **It runs commands you compose.** The whole point is to execute a real CLI with the arguments you
  set in the form. Treat the form like your own terminal — don't run something you wouldn't type.
- **The exact command is always shown before you Run it.** No hidden arguments; preview is generated
  from the *same* argument array that Run executes, so what you see is what runs.
- **Arguments are passed as an array to `spawn`, never concatenated into a shell.** A value
  containing spaces, quotes, `;`, or `&&` is passed verbatim as a single argument — there is no
  shell to interpret it, so form input can't inject extra commands.
- **The server binds `127.0.0.1` only.** It is not reachable from your network.
- **State-changing requests fail closed.** `POST /run` and `POST /stop` require a matching `Origin`
  header; a missing or foreign origin is rejected (CSRF protection). Exactly one run at a time, and
  closing the tab (dropping the stream) kills the child process — no orphans.
- **Your API key is never logged, echoed, or embedded in any served page.** The only data that
  leaves your machine is the tool's help text, sent to the Claude API for extraction. No telemetry.

## Contribute a schema

Want a tool to work keyless for everyone, like the demo tools do? Bundled schemas live in
[`schemas/`](schemas/) and are generated from captured `--help` fixtures:

1. Capture the tool's help into `test/fixtures/<tool>-help.txt`.
2. Add the tool to `scripts/gen-bundled-schemas.ts`.
3. Regenerate with your key: `ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/gen-bundled-schemas.ts`
   (a hallucination guard + golden check run before anything is written).
4. Open a PR with the fixture and the generated `schemas/<tool>.json`.

Each generated schema is validated so every flag appears verbatim in the source help text — no
hallucinated options. See [`schemas/README.md`](schemas/README.md) for provenance details.

## Requirements

- **Node.js ≥ 22**
- An `ANTHROPIC_API_KEY` only for extracting a tool that isn't bundled or cached.

## Non-goals (v0.1)

Deliberately out of scope to keep it small and sharp: interactive/TUI programs (vim, top, REPLs);
subcommand trees (flat tools only — `git commit` vs `git push` is v0.2); native file-picker dialogs;
a hosted version, auth, telemetry, or a plugin system; a local-LLM option (contributions welcome).

## License

MIT © Omar
