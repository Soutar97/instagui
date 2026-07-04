// server/client.ts — the browser-side script embedded in the served page (as a string, so
// the build stays a plain `tsc` with no bundler). It never composes commands itself: it
// collects form state and asks the server (POST /preview, POST /run) so core/compose.ts is
// the single source of truth. Run output arrives over SSE (/events); closing that stream is
// what the server watches to kill an orphaned child (AD-5).
//
// Authored as a template string rather than real TS because it runs in the browser, not Node.
// Kept intentionally small and framework-free (vanilla DOM).

export const CLIENT_SCRIPT = String.raw`
(function () {
  var form = document.getElementById('form');
  var previewEl = document.getElementById('preview');
  var statusEl = document.getElementById('status');
  var copyBtn = document.getElementById('copy');
  var runBtn = document.getElementById('run');
  var stopBtn = document.getElementById('stop');
  var outputEl = document.getElementById('output');
  var streamEl = document.getElementById('stream');
  var exitEl = document.getElementById('exit');

  var es = null;

  // Collect { options, positionals } from every [data-kind] control. Booleans are
  // true/false; everything else is the raw string value (compose decides emptiness).
  function collectState() {
    var options = {}, positionals = {};
    var els = form.querySelectorAll('[data-kind]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var name = el.getAttribute('data-name');
      var kind = el.getAttribute('data-kind');
      var value = el.type === 'checkbox' ? el.checked : el.value;
      if (kind === 'option') options[name] = value; else positionals[name] = value;
    }
    return { options: options, positionals: positionals };
  }

  var previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 60);
  }

  function updatePreview() {
    fetch('/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(collectState()),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && typeof data.preview === 'string') previewEl.textContent = data.preview; })
      .catch(function () { /* preview is best-effort; leave the last good value */ });
  }

  form.addEventListener('input', schedulePreview);
  form.addEventListener('change', schedulePreview);

  copyBtn.addEventListener('click', function () {
    var text = previewEl.textContent || '';
    var done = function () { statusEl.textContent = 'Copied.'; setTimeout(function () { statusEl.textContent = ''; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallbackCopy);
    } else fallbackCopy();
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });

  function setRunning(running) {
    runBtn.disabled = running;
    stopBtn.disabled = !running;
    form.querySelectorAll('[data-kind]').forEach(function (el) { el.disabled = running; });
  }

  function closeStream() { if (es) { es.close(); es = null; } }

  runBtn.addEventListener('click', function () {
    outputEl.hidden = false;
    streamEl.textContent = '';
    exitEl.textContent = '';
    exitEl.className = 'exit';
    statusEl.textContent = 'Starting…';
    setRunning(true);

    var state = collectState();
    closeStream();
    es = new EventSource('/events');

    es.addEventListener('out', function (ev) {
      streamEl.textContent += ev.data === '' ? '\n' : JSON.parse(ev.data);
      streamEl.scrollTop = streamEl.scrollHeight;
    });
    es.addEventListener('exit', function (ev) {
      var payload = JSON.parse(ev.data);
      var code = payload.code;
      if (payload.signal) exitEl.textContent = 'Stopped (' + payload.signal + ')';
      else if (code === null) exitEl.textContent = 'Command failed to start'; // e.g. missing binary
      else exitEl.textContent = 'Exit code: ' + code;
      // Anything but a clean 0 is styled as an error (red, bold) — including a failed start.
      exitEl.className = 'exit ' + (code === 0 ? 'ok' : 'bad');
      statusEl.textContent = '';
      setRunning(false);
      closeStream();
    });
    es.onopen = function () {
      statusEl.textContent = 'Running…';
      fetch('/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            statusEl.textContent = 'Run rejected: ' + (t || r.status);
            setRunning(false);
            closeStream();
          });
        }
      }).catch(function () {
        statusEl.textContent = 'Run failed to start.';
        setRunning(false);
        closeStream();
      });
    };
    es.onerror = function () {
      // A stream error after exit is expected (server closed it); only surface if still running.
      if (es && runBtn.disabled && !stopBtn.disabled) {
        statusEl.textContent = 'Connection lost.';
        setRunning(false);
        closeStream();
      }
    };
  });

  stopBtn.addEventListener('click', function () {
    statusEl.textContent = 'Stopping…';
    fetch('/stop', { method: 'POST' }).catch(function () {});
  });

  updatePreview();
})();
`;
