/**
 * Kitchen UI - Inline HTML/CSS/JS for the dev dashboard.
 *
 * Phase 1 MVP: Single-page dashboard with three panels.
 * No build step required — pure inline vanilla JS.
 */

export function renderKitchenHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mandu Kitchen</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="header">
    <div class="logo">
      <span class="logo-icon">🍡</span>
      <span class="logo-text">Mandu Kitchen</span>
    </div>
    <div class="status">
      <span id="sse-status" class="status-dot disconnected"></span>
      <span id="sse-label">Connecting...</span>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab" data-panel="activity">Activity</button>
    <button class="tab active" data-panel="routes">Routes</button>
    <button class="tab" data-panel="guard">Guard</button>
    <button class="tab" data-panel="preview">Preview</button>
    <button class="tab" data-panel="contracts">Contracts</button>
  </nav>

  <main class="panels">
    <section id="panel-activity" class="panel">
      <div class="panel-header">
        <h2>Activity Stream</h2>
        <button id="clear-activity" class="btn-sm">Clear</button>
      </div>
      <div id="activity-list" class="activity-list">
        <div class="empty-state">Waiting for MCP activity...</div>
      </div>
    </section>

    <section id="panel-routes" class="panel active">
      <div class="panel-header">
        <h2>Routes</h2>
        <div id="routes-summary" class="summary"></div>
      </div>
      <div id="routes-list" class="routes-list">
        <div class="empty-state">Loading routes...</div>
      </div>
    </section>

    <section id="panel-guard" class="panel">
      <div class="panel-header">
        <h2>Architecture Guard</h2>
        <button id="scan-guard" class="btn-sm">Scan</button>
      </div>
      <div id="guard-status" class="guard-status"></div>
      <div id="guard-list" class="violations-list">
        <div class="empty-state">Click "Scan" to check architecture rules.</div>
      </div>
    </section>

    <section id="panel-preview" class="panel">
      <div class="panel-header">
        <h2>Preview</h2>
        <button id="refresh-changes" class="btn-sm">Refresh</button>
      </div>
      <div id="preview-list" class="preview-list">
        <div class="empty-state">Loading file changes...</div>
      </div>
      <div id="preview-diff" class="preview-diff" style="display:none;"></div>
    </section>

    <section id="panel-contracts" class="panel">
      <div class="panel-header">
        <h2>Contracts</h2>
        <div style="display:flex;gap:4px;">
          <button id="export-openapi-json" class="btn-sm">Export JSON</button>
          <button id="export-openapi-yaml" class="btn-sm">Export YAML</button>
        </div>
      </div>
      <div class="contracts-layout">
        <div id="contracts-list" class="contracts-list">
          <div class="empty-state">Loading contracts...</div>
        </div>
        <div id="contracts-detail" class="contracts-detail">
          <div id="contract-schema" class="contract-schema"></div>
          <div id="contract-playground" class="contract-playground">
            <h3>Validate</h3>
            <div class="playground-controls">
              <select id="validate-method" class="select-sm">
                <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
              </select>
              <button id="validate-btn" class="btn-sm">Validate</button>
            </div>
            <div class="playground-inputs">
              <label>Query <textarea id="validate-query" rows="2" placeholder='{"key":"value"}'></textarea></label>
              <label>Body <textarea id="validate-body" rows="3" placeholder='{"key":"value"}'></textarea></label>
              <label>Params <textarea id="validate-params" rows="2" placeholder='{"id":"1"}'></textarea></label>
            </div>
            <div id="validate-result" class="validate-result"></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <div id="debug-bar" class="debug-bar"></div>

  <script>${JS}</script>
</body>
</html>`;
}

// ─── CSS ─────────────────────────────────────────

const CSS = /* css */ `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f1117;
    color: #e4e4e7;
    min-height: 100vh;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: #18181b;
    border-bottom: 1px solid #27272a;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 600;
  }

  .logo-icon { font-size: 24px; }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #a1a1aa;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transition: background 0.3s;
  }

  .status-dot.connected { background: #22c55e; }
  .status-dot.disconnected { background: #ef4444; }
  .status-dot.connecting { background: #eab308; }

  .tabs {
    display: flex;
    gap: 0;
    background: #18181b;
    border-bottom: 1px solid #27272a;
    padding: 0 20px;
  }

  .tab {
    padding: 10px 20px;
    background: none;
    border: none;
    color: #71717a;
    font-size: 14px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab:hover { color: #e4e4e7; }
  .tab.active {
    color: #a78bfa;
    border-bottom-color: #a78bfa;
  }

  .panels { padding: 16px 20px; }

  .panel { display: none; }
  .panel.active { display: block; }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .panel-header h2 {
    font-size: 16px;
    font-weight: 600;
  }

  .btn-sm {
    padding: 4px 12px;
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    color: #e4e4e7;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-sm:hover { background: #3f3f46; }
  .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: #52525b;
    font-size: 14px;
  }

  /* Activity */
  .activity-list {
    max-height: calc(100vh - 180px);
    overflow-y: auto;
  }

  .activity-item {
    padding: 8px 12px;
    border-bottom: 1px solid #1e1e22;
    font-size: 13px;
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .activity-time {
    color: #52525b;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .activity-tool {
    color: #a78bfa;
    font-weight: 500;
    flex-shrink: 0;
  }

  .activity-detail {
    color: #a1a1aa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Routes */
  .summary {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: #a1a1aa;
  }

  .summary-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .summary-count {
    font-weight: 600;
    color: #e4e4e7;
  }

  .route-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid #1e1e22;
    font-size: 13px;
  }

  .route-kind {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
    min-width: 44px;
    text-align: center;
  }

  .route-kind.page { background: #1e3a5f; color: #60a5fa; }
  .route-kind.api { background: #1a3c34; color: #4ade80; }

  .route-pattern {
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    color: #e4e4e7;
    flex: 1;
  }

  .route-badges {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    background: #27272a;
    color: #a1a1aa;
  }

  /* Guard */
  .guard-status {
    margin-bottom: 12px;
    font-size: 13px;
    color: #a1a1aa;
  }

  .guard-summary {
    display: flex;
    gap: 16px;
    padding: 12px;
    background: #18181b;
    border-radius: 8px;
    margin-bottom: 12px;
  }

  .guard-stat {
    text-align: center;
  }

  .guard-stat-value {
    font-size: 24px;
    font-weight: 700;
  }

  .guard-stat-label {
    font-size: 11px;
    color: #71717a;
    text-transform: uppercase;
  }

  .sev-error { color: #ef4444; }
  .sev-warning { color: #eab308; }
  .sev-info { color: #3b82f6; }

  .violation-item {
    padding: 8px 12px;
    border-bottom: 1px solid #1e1e22;
    font-size: 13px;
  }

  .violation-file {
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    color: #a78bfa;
    margin-bottom: 2px;
  }

  .violation-msg {
    color: #a1a1aa;
    font-size: 12px;
  }

  .violation-sev {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    margin-right: 4px;
  }

  .violation-sev.error { background: #3b1111; color: #ef4444; }
  .violation-sev.warning { background: #3b2f11; color: #eab308; }
  .violation-sev.info { background: #112840; color: #3b82f6; }

  /* Preview */
  .preview-list { max-height: 40vh; overflow-y: auto; }
  .preview-diff { max-height: 50vh; overflow-y: auto; padding: 8px; }

  .change-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #1e1e22;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .change-item:hover { background: #27272a; }
  .change-icon { flex-shrink: 0; }
  .change-path {
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    color: #e4e4e7;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .change-status {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    font-weight: 600;
    flex-shrink: 0;
  }
  .change-status.added { background: #1a3c34; color: #4ade80; }
  .change-status.modified { background: #1e3a5f; color: #60a5fa; }
  .change-status.deleted { background: #3b1111; color: #ef4444; }
  .change-status.untracked { background: #3b2f11; color: #eab308; }
  .change-status.renamed { background: #2a1a3c; color: #a78bfa; }

  .diff-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; background: #18181b; border-radius: 6px 6px 0 0;
    border-bottom: 1px solid #27272a;
  }
  .diff-file { font-family: monospace; color: #a78bfa; font-size: 13px; }
  .diff-stats { font-size: 12px; }
  .diff-add { color: #4ade80; margin-right: 8px; }
  .diff-del { color: #ef4444; }
  .diff-hunk-header { padding: 4px 12px; background: #112840; color: #3b82f6; font-size: 12px; font-family: monospace; }
  .diff-line { display: flex; font-family: monospace; font-size: 12px; line-height: 20px; }
  .diff-line-num { width: 40px; text-align: right; padding: 0 4px; color: #52525b; user-select: none; flex-shrink: 0; }
  .diff-line-content { flex: 1; padding: 0 8px; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .diff-line.add { background: rgba(74,222,128,0.08); }
  .diff-line.add .diff-line-content::before { content: '+'; color: #4ade80; }
  .diff-line.remove { background: rgba(239,68,68,0.08); }
  .diff-line.remove .diff-line-content::before { content: '-'; color: #ef4444; }
  .diff-line.context .diff-line-content::before { content: ' '; }

  /* Contracts */
  .contracts-layout { display: flex; gap: 12px; height: calc(100vh - 180px); }
  .contracts-list { width: 300px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid #27272a; padding-right: 12px; }
  .contracts-detail { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }

  .contract-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid #1e1e22;
    cursor: pointer; transition: background 0.15s; font-size: 13px;
  }
  .contract-item:hover { background: #27272a; }
  .contract-item.selected { background: #27272a; border-left: 2px solid #a78bfa; }

  .method-badge {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    flex-shrink: 0; min-width: 36px; text-align: center;
  }
  .method-badge.get { background: #1a3c34; color: #4ade80; }
  .method-badge.post { background: #1e3a5f; color: #60a5fa; }
  .method-badge.put { background: #3b2f11; color: #eab308; }
  .method-badge.patch { background: #2a1a3c; color: #a78bfa; }
  .method-badge.delete { background: #3b1111; color: #ef4444; }

  .contract-pattern { font-family: monospace; color: #e4e4e7; }

  .contract-schema {
    background: #18181b; border-radius: 8px; padding: 12px;
    font-family: monospace; font-size: 12px; white-space: pre-wrap;
    max-height: 40vh; overflow-y: auto;
  }

  .contract-playground { background: #18181b; border-radius: 8px; padding: 12px; }
  .contract-playground h3 { font-size: 14px; margin-bottom: 8px; }

  .playground-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .select-sm {
    padding: 4px 8px; background: #27272a; border: 1px solid #3f3f46;
    border-radius: 6px; color: #e4e4e7; font-size: 12px;
  }
  .playground-inputs { display: flex; flex-direction: column; gap: 6px; }
  .playground-inputs label { font-size: 11px; color: #71717a; display: flex; flex-direction: column; gap: 2px; }
  .playground-inputs textarea {
    background: #27272a; border: 1px solid #3f3f46; border-radius: 4px;
    color: #e4e4e7; font-family: monospace; font-size: 12px; padding: 6px;
    resize: vertical;
  }
  .validate-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 12px; font-family: monospace; }
  .validate-result.success { background: #1a3c34; color: #4ade80; }
  .validate-result.error { background: #3b1111; color: #ef4444; }

  .debug-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 4px 12px;
    background: #1a1a2e;
    border-top: 1px solid #27272a;
    font-size: 11px;
    font-family: monospace;
    color: #71717a;
    max-height: 60px;
    overflow-y: auto;
  }

  .debug-bar .err { color: #ef4444; }
  .debug-bar .ok { color: #22c55e; }
`;

// ─── JavaScript ──────────────────────────────────

const JS = /* js */ `
(function() {
  var dbg = document.getElementById('debug-bar');
  function log(msg, cls) {
    if (!dbg) return;
    var s = document.createElement('span');
    s.className = cls || '';
    s.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg + '  ';
    dbg.appendChild(s);
    dbg.scrollTop = dbg.scrollHeight;
    console.log('[Kitchen]', msg);
  }

  function escapeHtml(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  try { log('JS loaded', 'ok'); } catch(e) {}

  // Tab switching
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() {
      var all = document.querySelectorAll('.tab');
      var panels = document.querySelectorAll('.panel');
      for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
      for (var j = 0; j < panels.length; j++) panels[j].classList.remove('active');
      this.classList.add('active');
      var p = document.getElementById('panel-' + this.getAttribute('data-panel'));
      if (p) p.classList.add('active');
    });
  }

  // ─── SSE Activity Stream ─────────────────────
  var statusDot = document.getElementById('sse-status');
  var statusLabel = document.getElementById('sse-label');
  var activityList = document.getElementById('activity-list');
  var activityCount = 0;
  var MAX_ITEMS = 200;
  var sseRetryCount = 0;

  function connectSSE() {
    statusDot.className = 'status-dot connecting';
    statusLabel.textContent = 'Connecting...';
    log('SSE connecting...');

    var es;
    try {
      es = new EventSource('/__kitchen/sse/activity');
    } catch(e) {
      log('SSE EventSource failed: ' + e.message, 'err');
      statusDot.className = 'status-dot disconnected';
      statusLabel.textContent = 'Failed';
      return;
    }

    es.onopen = function() {
      statusDot.className = 'status-dot connected';
      statusLabel.textContent = 'Connected';
      sseRetryCount = 0;
      log('SSE connected', 'ok');
    };

    es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'connected') {
          log('SSE welcome: ' + data.clientId, 'ok');
          return;
        }
        if (data.type === 'heartbeat') return;
        appendActivity(data);
      } catch(err) {
        log('SSE parse error: ' + err.message, 'err');
      }
    };

    es.onerror = function(evt) {
      log('SSE error (readyState=' + es.readyState + ')', 'err');
      statusDot.className = 'status-dot disconnected';
      statusLabel.textContent = 'Disconnected';
      es.close();
      sseRetryCount++;
      var delay = Math.min(3000 * sseRetryCount, 15000);
      log('SSE retry in ' + (delay/1000) + 's');
      setTimeout(connectSSE, delay);
    };
  }

  function appendActivity(data) {
    if (activityCount === 0) {
      activityList.innerHTML = '';
    }
    activityCount++;

    var item = document.createElement('div');
    item.className = 'activity-item';

    var ts = data.ts || data.timestamp || new Date().toISOString();
    var time = new Date(ts).toLocaleTimeString();
    var tool = data.tool || data.type || 'event';
    var detail = data.description || data.message || data.resource || JSON.stringify(data).substring(0, 120);

    item.innerHTML =
      '<span class="activity-time">' + escapeHtml(time) + '</span>' +
      '<span class="activity-tool">' + escapeHtml(tool) + '</span>' +
      '<span class="activity-detail">' + escapeHtml(detail) + '</span>';

    activityList.insertBefore(item, activityList.firstChild);

    while (activityList.children.length > MAX_ITEMS) {
      activityList.removeChild(activityList.lastChild);
    }
  }

  document.getElementById('clear-activity').addEventListener('click', function() {
    activityList.innerHTML = '<div class="empty-state">Waiting for MCP activity...</div>';
    activityCount = 0;
  });

  connectSSE();

  // ─── Routes ──────────────────────────────────
  function loadRoutes() {
    log('Fetching routes...');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/routes', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          log('Routes loaded: ' + data.summary.total + ' routes', 'ok');
          renderRoutes(data);
        } catch(e) {
          log('Routes parse error: ' + e.message, 'err');
        }
      } else {
        log('Routes HTTP ' + xhr.status, 'err');
        document.getElementById('routes-list').innerHTML =
          '<div class="empty-state">Failed to load routes (HTTP ' + xhr.status + ')</div>';
      }
    };
    xhr.onerror = function() {
      log('Routes network error', 'err');
      document.getElementById('routes-list').innerHTML =
        '<div class="empty-state">Network error loading routes.</div>';
    };
    xhr.send();
  }

  function renderRoutes(data) {
    var summaryEl = document.getElementById('routes-summary');
    var listEl = document.getElementById('routes-list');
    var s = data.summary;

    summaryEl.innerHTML =
      '<span class="summary-item"><span class="summary-count">' + s.total + '</span> total</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.pages + '</span> pages</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.apis + '</span> APIs</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.withIslands + '</span> islands</span>';

    if (!data.routes.length) {
      listEl.innerHTML = '<div class="empty-state">No routes found.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < data.routes.length; i++) {
      var r = data.routes[i];
      var badges = '';
      if (r.hasSlot) badges += '<span class="badge">slot</span>';
      if (r.hasContract) badges += '<span class="badge">contract</span>';
      if (r.hasClient) badges += '<span class="badge">island</span>';
      if (r.hasLayout) badges += '<span class="badge">layout</span>';
      if (r.hydration && r.hydration !== 'none') badges += '<span class="badge">' + escapeHtml(r.hydration) + '</span>';

      html += '<div class="route-item">' +
        '<span class="route-kind ' + r.kind + '">' + r.kind + '</span>' +
        '<span class="route-pattern">' + escapeHtml(r.pattern) + '</span>' +
        '<span class="route-badges">' + badges + '</span>' +
        '</div>';
    }
    listEl.innerHTML = html;
  }

  loadRoutes();

  // ─── Guard ───────────────────────────────────
  var scanBtn = document.getElementById('scan-guard');
  var guardStatusEl = document.getElementById('guard-status');
  var guardListEl = document.getElementById('guard-list');

  function loadGuardStatus() {
    log('Fetching guard status...');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/guard', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          log('Guard: ' + (data.enabled ? 'enabled (' + data.preset + ')' : 'disabled'), 'ok');
          renderGuardData(data);
        } catch(e) {
          log('Guard parse error: ' + e.message, 'err');
        }
      }
    };
    xhr.onerror = function() { log('Guard network error', 'err'); };
    xhr.send();
  }

  scanBtn.addEventListener('click', function() {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    log('Guard scan started...');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/__kitchen/api/guard/scan', true);
    xhr.onload = function() {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          log('Guard scan done: ' + (data.report ? data.report.totalViolations + ' violations' : 'no report'), 'ok');
          renderGuardData(data);
        } catch(e) {
          log('Guard scan parse error: ' + e.message, 'err');
        }
      } else {
        log('Guard scan HTTP ' + xhr.status, 'err');
        guardStatusEl.textContent = 'Scan failed.';
      }
    };
    xhr.onerror = function() {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
      log('Guard scan network error', 'err');
      guardStatusEl.textContent = 'Scan failed.';
    };
    xhr.send();
  });

  function renderGuardData(data) {
    if (!data.enabled) {
      guardStatusEl.textContent = 'Guard is not configured for this project.';
      guardListEl.innerHTML = '';
      return;
    }

    guardStatusEl.innerHTML = 'Preset: <strong>' + escapeHtml(data.preset) + '</strong>';

    if (!data.report) {
      guardListEl.innerHTML = '<div class="empty-state">No scan results yet. Click "Scan" to check.</div>';
      return;
    }

    var r = data.report;
    var summaryHtml = '<div class="guard-summary">' +
      '<div class="guard-stat"><div class="guard-stat-value">' + r.totalViolations + '</div><div class="guard-stat-label">Total</div></div>' +
      '<div class="guard-stat"><div class="guard-stat-value sev-error">' + (r.bySeverity.error || 0) + '</div><div class="guard-stat-label">Errors</div></div>' +
      '<div class="guard-stat"><div class="guard-stat-value sev-warning">' + (r.bySeverity.warning || 0) + '</div><div class="guard-stat-label">Warnings</div></div>' +
      '<div class="guard-stat"><div class="guard-stat-value sev-info">' + (r.bySeverity.info || 0) + '</div><div class="guard-stat-label">Info</div></div>' +
      '</div>';

    if (!r.violations.length) {
      guardListEl.innerHTML = summaryHtml + '<div class="empty-state">No violations found!</div>';
      return;
    }

    var violHtml = '';
    var list = r.violations.length > 100 ? r.violations.slice(0, 100) : r.violations;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      violHtml += '<div class="violation-item">' +
        '<div class="violation-file">' +
          '<span class="violation-sev ' + v.severity + '">' + v.severity + '</span>' +
          escapeHtml(v.filePath) + ':' + v.line +
        '</div>' +
        '<div class="violation-msg">' +
          escapeHtml(v.fromLayer) + ' &rarr; ' + escapeHtml(v.toLayer) + ': ' + escapeHtml(v.ruleDescription) +
        '</div>' +
        '</div>';
    }
    guardListEl.innerHTML = summaryHtml + violHtml;
  }

  loadGuardStatus();

  // ─── Preview ──────────────────────────────────
  var previewListEl = document.getElementById('preview-list');
  var previewDiffEl = document.getElementById('preview-diff');
  var refreshChangesBtn = document.getElementById('refresh-changes');

  function loadFileChanges() {
    log('Fetching file changes...');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/file/changes', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          log('Changes loaded: ' + data.changes.length, 'ok');
          renderFileChanges(data.changes);
        } catch(e) {
          log('Changes parse error: ' + e.message, 'err');
        }
      }
    };
    xhr.onerror = function() { log('Changes network error', 'err'); };
    xhr.send();
  }

  function renderFileChanges(changes) {
    if (!changes.length) {
      previewListEl.innerHTML = '<div class="empty-state">No file changes detected.</div>';
      return;
    }
    var html = '';
    var icons = { added: '+', modified: '~', deleted: '-', untracked: '?', renamed: 'R' };
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      html += '<div class="change-item" data-path="' + escapeHtml(c.filePath) + '">' +
        '<span class="change-icon">' + (icons[c.status] || '?') + '</span>' +
        '<span class="change-path">' + escapeHtml(c.filePath) + '</span>' +
        '<span class="change-status ' + c.status + '">' + c.status + '</span>' +
        '</div>';
    }
    previewListEl.innerHTML = html;

    // Attach click handlers
    var items = previewListEl.querySelectorAll('.change-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        var p = this.getAttribute('data-path');
        loadFileDiff(p);
      });
    }
  }

  function loadFileDiff(filePath) {
    log('Fetching diff for ' + filePath);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/file/diff?path=' + encodeURIComponent(filePath), true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var diff = JSON.parse(xhr.responseText);
          renderDiff(diff);
        } catch(e) {
          log('Diff parse error: ' + e.message, 'err');
        }
      }
    };
    xhr.onerror = function() { log('Diff network error', 'err'); };
    xhr.send();
  }

  function renderDiff(diff) {
    if (!diff.hunks || !diff.hunks.length) {
      previewDiffEl.innerHTML = '<div class="empty-state">No diff available.</div>';
      previewDiffEl.style.display = 'block';
      return;
    }
    var html = '<div class="diff-header">' +
      '<span class="diff-file">' + escapeHtml(diff.filePath) + '</span>' +
      '<span class="diff-stats"><span class="diff-add">+' + diff.additions + '</span><span class="diff-del">-' + diff.deletions + '</span></span>' +
      '<button class="btn-sm" onclick="document.getElementById(\'preview-diff\').style.display=\'none\'">Close</button>' +
      '</div>';
    for (var h = 0; h < diff.hunks.length; h++) {
      var hunk = diff.hunks[h];
      html += '<div class="diff-hunk-header">' + escapeHtml(hunk.header) + '</div>';
      for (var l = 0; l < hunk.lines.length; l++) {
        var line = hunk.lines[l];
        var cls = line.type === 'add' ? 'add' : line.type === 'remove' ? 'remove' : 'context';
        html += '<div class="diff-line ' + cls + '">' +
          '<span class="diff-line-num">' + (line.oldLine || '') + '</span>' +
          '<span class="diff-line-num">' + (line.newLine || '') + '</span>' +
          '<span class="diff-line-content">' + escapeHtml(line.content) + '</span>' +
          '</div>';
      }
    }
    previewDiffEl.innerHTML = html;
    previewDiffEl.style.display = 'block';
  }

  refreshChangesBtn.addEventListener('click', loadFileChanges);
  loadFileChanges();

  // ─── Contracts ─────────────────────────────────
  var contractsListEl = document.getElementById('contracts-list');
  var contractSchemaEl = document.getElementById('contract-schema');
  var validateBtn = document.getElementById('validate-btn');
  var validateResultEl = document.getElementById('validate-result');
  var exportJsonBtn = document.getElementById('export-openapi-json');
  var exportYamlBtn = document.getElementById('export-openapi-yaml');
  var selectedContractId = null;

  function loadContracts() {
    log('Fetching contracts...');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/contracts', true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          log('Contracts loaded: ' + data.contracts.length, 'ok');
          renderContractsList(data.contracts);
        } catch(e) {
          log('Contracts parse error: ' + e.message, 'err');
          contractsListEl.innerHTML = '<div class="empty-state">Failed to parse contracts.</div>';
        }
      } else if (xhr.status === 404) {
        contractsListEl.innerHTML = '<div class="empty-state">Contracts API not available.</div>';
      }
    };
    xhr.onerror = function() {
      log('Contracts network error', 'err');
      contractsListEl.innerHTML = '<div class="empty-state">Network error.</div>';
    };
    xhr.send();
  }

  function renderContractsList(contracts) {
    if (!contracts.length) {
      contractsListEl.innerHTML = '<div class="empty-state">No contracts found.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < contracts.length; i++) {
      var c = contracts[i];
      var methods = (c.methods || []).map(function(m) {
        return '<span class="method-badge ' + m.toLowerCase() + '">' + m + '</span>';
      }).join('');
      html += '<div class="contract-item" data-id="' + escapeHtml(c.id) + '">' +
        methods +
        '<span class="contract-pattern">' + escapeHtml(c.pattern) + '</span>' +
        '</div>';
    }
    contractsListEl.innerHTML = html;

    var items = contractsListEl.querySelectorAll('.contract-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        selectedContractId = id;
        var all = contractsListEl.querySelectorAll('.contract-item');
        for (var k = 0; k < all.length; k++) all[k].classList.remove('selected');
        this.classList.add('selected');
        loadContractDetail(id);
      });
    }
  }

  function loadContractDetail(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__kitchen/api/contracts/' + encodeURIComponent(id), true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          contractSchemaEl.textContent = JSON.stringify(data, null, 2);
        } catch(e) {
          contractSchemaEl.textContent = 'Parse error';
        }
      }
    };
    xhr.send();
  }

  validateBtn.addEventListener('click', function() {
    if (!selectedContractId) {
      validateResultEl.className = 'validate-result error';
      validateResultEl.textContent = 'Select a contract first.';
      return;
    }
    var method = document.getElementById('validate-method').value;
    var input = {};
    try {
      var q = document.getElementById('validate-query').value.trim();
      var b = document.getElementById('validate-body').value.trim();
      var p = document.getElementById('validate-params').value.trim();
      if (q) input.query = JSON.parse(q);
      if (b) input.body = JSON.parse(b);
      if (p) input.params = JSON.parse(p);
    } catch(e) {
      validateResultEl.className = 'validate-result error';
      validateResultEl.textContent = 'Invalid JSON: ' + e.message;
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/__kitchen/api/contracts/validate', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      try {
        var result = JSON.parse(xhr.responseText);
        if (result.valid) {
          validateResultEl.className = 'validate-result success';
          validateResultEl.textContent = 'Validation passed!';
        } else {
          validateResultEl.className = 'validate-result error';
          validateResultEl.textContent = JSON.stringify(result.errors || result, null, 2);
        }
      } catch(e) {
        validateResultEl.className = 'validate-result error';
        validateResultEl.textContent = 'Response parse error';
      }
    };
    xhr.send(JSON.stringify({ contractId: selectedContractId, method: method, input: input }));
  });

  exportJsonBtn.addEventListener('click', function() {
    window.open('/__kitchen/api/contracts/openapi', '_blank');
  });

  exportYamlBtn.addEventListener('click', function() {
    window.open('/__kitchen/api/contracts/openapi.yaml', '_blank');
  });

  loadContracts();

})();
`;
