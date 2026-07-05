// server/page.ts — Story 3.1 (form) + 3.2 (live preview + copy) + 3.3 (run + stream).
// Renders the resolved Schema as a single self-contained HTML page: a vanilla Form whose
// controls map from option types, a live command preview, and Run/Stop with streamed output.
//
// The page ships the Schema to the client as embedded JSON only so the client can build the
// { options, positionals } form-state object; it does NOT re-implement compose. Preview and
// Run both round-trip that state to the server (POST /preview, POST /run), so core/compose.ts
// is the single source of truth for the arg array and there is no client/server divergence
// (AC 3.2). The API key never touches this page — only the Schema and tool name do (NFR-2).
import type { Schema, Option, Positional } from '../core/schema.js';

/** Escape a string for use as HTML text or inside a double-quoted attribute. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Embed a value as JSON inside a <script> tag without letting "</script>" break out. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** Render one option control. File paths are plain text fields — scope fence: no native
 *  picker (AC 3.1). Booleans → checkbox, enums → dropdown, number → number input. */
function optionControl(o: Option): string {
  const id = `opt-${o.name}`;
  const label =
    `<label for="${esc(id)}">` +
    `<span class="name">${esc(o.name)}</span>` +
    `<code class="flag">${esc(o.flag)}</code>` +
    (o.required ? '<span class="req" title="required">*</span>' : '') +
    `</label>`;
  const desc = o.description ? `<p class="desc">${esc(o.description)}</p>` : '';

  const common =
    `id="${esc(id)}" data-kind="option" data-name="${esc(o.name)}" data-type="${esc(o.type)}"` +
    (o.required ? ' data-required="true"' : '');

  let control: string;
  if (o.type === 'boolean') {
    control = `<input type="checkbox" ${common} />`;
  } else if (o.type === 'enum') {
    const opts = ['<option value=""></option>', ...o.enumValues.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)];
    control = `<select ${common}>${opts.join('')}</select>`;
  } else if (o.type === 'number') {
    control = `<input type="number" ${common} placeholder="${esc(o.flag)}" />`;
  } else {
    // string | path — both plain text fields (no picker for path).
    const hint = o.type === 'path' ? ' placeholder="path…"' : '';
    control = `<input type="text" ${common}${hint} />`;
  }

  const cls = o.type === 'boolean' ? 'field field-bool' : 'field';
  return `<div class="${cls}">${label}${control}${desc}</div>`;
}

/** Render one positional control. Always a text field (variadic is a hint only in v1 so each
 *  positional contributes exactly one verbatim argument). */
function positionalControl(p: Positional): string {
  const id = `pos-${p.name}`;
  const label =
    `<label for="${esc(id)}">` +
    `<span class="name">${esc(p.name)}</span>` +
    (p.variadic ? '<span class="badge">multiple</span>' : '') +
    (p.required ? '<span class="req" title="required">*</span>' : '') +
    `</label>`;
  const desc = p.description ? `<p class="desc">${esc(p.description)}</p>` : '';
  const placeholder = p.type === 'path' ? 'path…' : p.name;
  const control =
    `<input type="text" id="${esc(id)}" data-kind="positional" data-name="${esc(p.name)}" ` +
    `data-type="${esc(p.type)}"${p.required ? ' data-required="true"' : ''} placeholder="${esc(placeholder)}" />`;
  return `<div class="field">${label}${control}${desc}</div>`;
}

/** Group options by their `group` field, preserving first-seen order; "" → "Options". */
function groupOptions(options: Option[]): { group: string; options: Option[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, Option[]>();
  for (const o of options) {
    const g = o.group || 'Options';
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g)!.push(o);
  }
  return order.map((group) => ({ group, options: byGroup.get(group)! }));
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  margin: 0; background: Canvas; color: CanvasText; line-height: 1.45; }
header { padding: 1rem 1.25rem; border-bottom: 1px solid rgba(128,128,128,.3); }
header h1 { margin: 0; font-size: 1.15rem; }
header h1 code { font-size: 1.15rem; }
header .summary { margin: .25rem 0 0; opacity: .8; font-size: .9rem; }
main { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,26rem); gap: 1.25rem;
  padding: 1.25rem; align-items: start; }
@media (max-width: 800px) { main { grid-template-columns: 1fr; } }
fieldset { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; margin: 0 0 1rem; padding: .75rem 1rem 1rem; }
legend { font-weight: 600; padding: 0 .4rem; }
.field { margin: .55rem 0; }
.field-bool { display: flex; align-items: center; gap: .5rem; }
.field-bool label { order: 2; margin: 0; }
label { display: flex; align-items: baseline; gap: .5rem; font-size: .9rem; margin-bottom: .2rem; }
label .name { font-weight: 600; }
code.flag { font-size: .8rem; opacity: .75; }
.req { color: #d33; font-weight: 700; }
.badge { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6;
  border: 1px solid currentColor; border-radius: 4px; padding: 0 .25rem; }
.desc { margin: .15rem 0 0; font-size: .78rem; opacity: .7; }
input[type=text], input[type=number], select { width: 100%; padding: .4rem .5rem; font: inherit;
  border: 1px solid rgba(128,128,128,.4); border-radius: 6px; background: Field; color: FieldText; }
.side { position: sticky; top: 1.25rem; }
.preview { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: .75rem; }
.preview h2 { margin: 0 0 .5rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
pre.cmd { margin: 0; padding: .6rem .7rem; background: rgba(128,128,128,.12); border-radius: 6px;
  white-space: pre-wrap; word-break: break-all; font-size: .85rem; min-height: 1.2rem; }
.row { display: flex; gap: .5rem; margin-top: .6rem; flex-wrap: wrap; }
button { font: inherit; padding: .45rem .9rem; border-radius: 6px; border: 1px solid rgba(128,128,128,.4);
  background: rgba(128,128,128,.12); color: inherit; cursor: pointer; }
button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
button:disabled { opacity: .5; cursor: not-allowed; }
.output { margin-top: 1rem; }
pre.stream { margin: .4rem 0 0; padding: .6rem .7rem; background: #0b0b0b; color: #e6e6e6;
  border-radius: 6px; max-height: 24rem; overflow: auto; white-space: pre-wrap; word-break: break-all;
  font-size: .82rem; min-height: 2rem; }
.exit { margin-top: .5rem; font-size: .85rem; }
.exit.ok { color: #16a34a; } .exit.bad { color: #dc2626; font-weight: 600; }
.status { font-size: .8rem; opacity: .7; margin-top: .3rem; }
`;

/**
 * Render the full single-page HTML document for `schema`. Self-contained (inline CSS + JS,
 * no external resources). The embedded client script lives in server/client.ts.
 */
export function renderPage(schema: Schema, clientScript: string): string {
  const groups = groupOptions(schema.options);
  const optionsHtml = groups
    .map(
      (g) =>
        `<fieldset><legend>${esc(g.group)}</legend>${g.options.map(optionControl).join('')}</fieldset>`,
    )
    .join('');
  const positionalsHtml = schema.positionals.length
    ? `<fieldset><legend>Arguments</legend>${schema.positionals.map(positionalControl).join('')}</fieldset>`
    : '';
  const summary = schema.summary ? `<p class="summary">${esc(schema.summary)}</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>instagui — ${esc(schema.tool)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>instagui <code>${esc(schema.tool)}</code></h1>
  ${summary}
</header>
<main>
  <form id="form" autocomplete="off">
    ${positionalsHtml}
    ${optionsHtml}
  </form>
  <div class="side">
    <div class="preview">
      <h2>Command preview</h2>
      <pre class="cmd" id="preview">${esc(schema.tool)}</pre>
      <div class="row">
        <button type="button" id="copy">Copy</button>
        <button type="button" id="run" class="primary">Run</button>
        <button type="button" id="stop" disabled>Stop</button>
      </div>
      <div class="status" id="status"></div>
    </div>
    <div class="output" id="output" hidden>
      <h2>Output</h2>
      <pre class="stream" id="stream"></pre>
      <div class="exit" id="exit"></div>
    </div>
  </div>
</main>
<script type="application/json" id="schema">${safeJson(schema)}</script>
<script>${clientScript}</script>
</body>
</html>`;
}
