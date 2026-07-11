# instagui — Local Server API Contracts

_Generated: 2026-07-09 · Deep scan · Source: `src/server/server.ts`_

instagui exposes **no public/remote API**. It runs a local `node:http` server bound to **`127.0.0.1`
only** (NFR-2), on default port **5177** (falls back to an OS-assigned free port on `EADDRINUSE`). The
browser Form is the only client. State-changing routes fail closed on a bad `Origin` (CSRF, AD-6).
Request bodies are capped at **512 KB** (→ `413`).

## Endpoints

### `GET /`
Serves the self-contained single-page Form (inline CSS + JS, embedded Schema JSON). No auth.
- **200** `text/html`

### `POST /preview`
Read-only. Composes the current form state into a command (no CSRF check needed — no side effects).
- **Request body**: JSON `{ options?: Record<string,unknown>, positionals?: Record<string,unknown> }`
  (empty body → `{}`).
- **200** `application/json` → `{ args: string[], preview: string }`
- **400** invalid JSON · **413** body too large

### `GET /events`
Server-Sent Events stream. **Owns the run lifecycle**: the newest connection replaces any prior one,
and a disconnect (tab close/reload) stops the running child (AD-5 — no orphaned process).
- **200** `text/event-stream`
- Events:
  - `event: out` → `data: <json-encoded chunk>` — stdout/stderr output (JSON-encoded so embedded
    newlines never break SSE framing).
  - `event: exit` → `data: { code: number|null, signal: string|null }` — run completion.

### `POST /run`
Compose the form state and spawn the command (args array, `shell:false`). Exactly one run in flight.
- **CSRF**: requires a valid `Origin` matching the bound host — else **403**.
- **Precondition**: the SSE stream (`GET /events`) must be open first — else **428**.
- **Request body**: same shape as `/preview`.
- **202** `running` · **403** bad Origin · **409** a run is already in progress · **413** too large ·
  **428** open the event stream first · **400** invalid JSON
- Output and the exit result arrive on the **SSE** stream, not in this response.

### `POST /stop`
Kill the running child, if any (SIGTERM → SIGKILL after 2s).
- **CSRF**: valid `Origin` required — else **403**.
- **200** `stopping` (there was a child) or `nothing to stop`.

## Notes

- The **API key never reaches this server surface** — only the Schema and tool name are served to the
  page.
- `404` for any other route; `500 instagui: internal error` on an unhandled handler throw.
- CSRF allow-list accepts `http://<host>:<port>`, `http://localhost:<port>`, `http://127.0.0.1:<port>`.
