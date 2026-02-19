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
    <button class="tab active" data-panel="activity">Activity</button>
    <button class="tab" data-panel="routes">Routes</button>
    <button class="tab" data-panel="guard">Guard</button>
  </nav>

  <main class="panels">
    <section id="panel-activity" class="panel active">
      <div class="panel-header">
        <h2>Activity Stream</h2>
        <button id="clear-activity" class="btn-sm">Clear</button>
      </div>
      <div id="activity-list" class="activity-list">
        <div class="empty-state">Waiting for MCP activity...</div>
      </div>
    </section>

    <section id="panel-routes" class="panel">
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
  </main>

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
`;

// ─── JavaScript ──────────────────────────────────

const JS = /* js */ `
(function() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
    });
  });

  // ─── SSE Activity Stream ─────────────────────
  const statusDot = document.getElementById('sse-status');
  const statusLabel = document.getElementById('sse-label');
  const activityList = document.getElementById('activity-list');
  let activityCount = 0;
  const MAX_ITEMS = 200;

  function connectSSE() {
    statusDot.className = 'status-dot connecting';
    statusLabel.textContent = 'Connecting...';

    const es = new EventSource('/__kitchen/sse/activity');

    es.onopen = () => {
      statusDot.className = 'status-dot connected';
      statusLabel.textContent = 'Connected';
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'heartbeat' || data.type === 'connected') return;
        appendActivity(data);
      } catch {}
    };

    es.onerror = () => {
      statusDot.className = 'status-dot disconnected';
      statusLabel.textContent = 'Disconnected';
      es.close();
      setTimeout(connectSSE, 3000);
    };
  }

  function appendActivity(data) {
    if (activityCount === 0) {
      activityList.innerHTML = '';
    }
    activityCount++;

    const item = document.createElement('div');
    item.className = 'activity-item';

    const ts = data.ts || data.timestamp || new Date().toISOString();
    const time = new Date(ts).toLocaleTimeString();
    const tool = data.tool || data.type || 'event';
    const detail = data.description || data.message || data.resource || JSON.stringify(data).slice(0, 120);

    item.innerHTML =
      '<span class="activity-time">' + time + '</span>' +
      '<span class="activity-tool">' + escapeHtml(tool) + '</span>' +
      '<span class="activity-detail">' + escapeHtml(detail) + '</span>';

    activityList.prepend(item);

    // Trim old items
    while (activityList.children.length > MAX_ITEMS) {
      activityList.removeChild(activityList.lastChild);
    }
  }

  document.getElementById('clear-activity').addEventListener('click', () => {
    activityList.innerHTML = '<div class="empty-state">Waiting for MCP activity...</div>';
    activityCount = 0;
  });

  connectSSE();

  // ─── Routes ──────────────────────────────────
  async function loadRoutes() {
    try {
      const res = await fetch('/__kitchen/api/routes');
      const data = await res.json();
      renderRoutes(data);
    } catch (err) {
      document.getElementById('routes-list').innerHTML =
        '<div class="empty-state">Failed to load routes.</div>';
    }
  }

  function renderRoutes(data) {
    const summaryEl = document.getElementById('routes-summary');
    const listEl = document.getElementById('routes-list');
    const s = data.summary;

    summaryEl.innerHTML =
      '<span class="summary-item"><span class="summary-count">' + s.total + '</span> total</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.pages + '</span> pages</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.apis + '</span> APIs</span>' +
      '<span class="summary-item"><span class="summary-count">' + s.withIslands + '</span> islands</span>';

    if (!data.routes.length) {
      listEl.innerHTML = '<div class="empty-state">No routes found.</div>';
      return;
    }

    listEl.innerHTML = data.routes.map(function(r) {
      var badges = '';
      if (r.hasSlot) badges += '<span class="badge">slot</span>';
      if (r.hasContract) badges += '<span class="badge">contract</span>';
      if (r.hasClient) badges += '<span class="badge">island</span>';
      if (r.hasLayout) badges += '<span class="badge">layout</span>';
      if (r.hydration && r.hydration !== 'none') badges += '<span class="badge">' + r.hydration + '</span>';

      return '<div class="route-item">' +
        '<span class="route-kind ' + r.kind + '">' + r.kind + '</span>' +
        '<span class="route-pattern">' + escapeHtml(r.pattern) + '</span>' +
        '<span class="route-badges">' + badges + '</span>' +
        '</div>';
    }).join('');
  }

  loadRoutes();

  // ─── Guard ───────────────────────────────────
  const scanBtn = document.getElementById('scan-guard');
  const guardStatusEl = document.getElementById('guard-status');
  const guardListEl = document.getElementById('guard-list');

  async function loadGuardStatus() {
    try {
      const res = await fetch('/__kitchen/api/guard');
      const data = await res.json();
      renderGuardData(data);
    } catch {}
  }

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    try {
      const res = await fetch('/__kitchen/api/guard/scan', { method: 'POST' });
      const data = await res.json();
      renderGuardData(data);
    } catch (err) {
      guardStatusEl.textContent = 'Scan failed.';
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
    }
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

    guardListEl.innerHTML = summaryHtml + r.violations.slice(0, 100).map(function(v) {
      return '<div class="violation-item">' +
        '<div class="violation-file">' +
          '<span class="violation-sev ' + v.severity + '">' + v.severity + '</span>' +
          escapeHtml(v.filePath) + ':' + v.line +
        '</div>' +
        '<div class="violation-msg">' +
          escapeHtml(v.fromLayer) + ' → ' + escapeHtml(v.toLayer) + ': ' + escapeHtml(v.ruleDescription) +
        '</div>' +
        '</div>';
    }).join('');
  }

  loadGuardStatus();

  // ─── Helpers ─────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
`;
