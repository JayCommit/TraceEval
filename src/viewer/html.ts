import { TraceSession, GoldenBaseline, RegressionDiff, TraceEvent } from "../types/index.js";
import { extractDiffFromEvent, renderDiffHtml } from "./diff.js";

export * from "./diff.js";

export interface ViewerOptions {
  golden?: GoldenBaseline | null;
  diff?: RegressionDiff | null;
  sessionsList?: Array<{ id: string; agent: string; startTime: string; status: string; eventCount: number }>;
  isLive?: boolean;
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  const s = typeof str === "string" ? str : JSON.stringify(str, null, 2);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateTraceHtml(session: TraceSession, options: ViewerOptions = {}): string {
  const { golden, diff, isLive = false } = options;

  const toolCalls = session.events.filter((e) => e.type === "tool_call" || e.type === "tool_call_start");
  const fileChanges = session.events.filter((e) => e.type === "file_change");

  // Aggregate cost and tokens
  const totalCost = (session.metadata?.cost ?? session.metadata?.totalCost ?? 0) as number;
  const totalTokens = (session.metadata?.tokens ?? session.metadata?.totalTokens ?? 0) as number;

  const durationStr = session.durationMs !== undefined
    ? `${session.durationMs}ms`
    : (session.endTime ? `${new Date(session.endTime).getTime() - new Date(session.startTime).getTime()}ms` : "In progress");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TraceEval — ${escapeHtml(session.id)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
      --purple: #bc8cff;
      --code-bg: #0a0d12;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 24px;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand h1 {
      font-size: 20px;
      font-weight: 700;
      color: #f0f6fc;
      letter-spacing: -0.5px;
    }

    .brand .tagline {
      color: var(--text-muted);
      font-size: 13px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge-success { background: rgba(63, 185, 80, 0.15); color: var(--success); border: 1px solid var(--success); }
    .badge-error { background: rgba(248, 81, 73, 0.15); color: var(--danger); border: 1px solid var(--danger); }
    .badge-active { background: rgba(88, 166, 255, 0.15); color: var(--accent); border: 1px solid var(--accent); }
    .badge-neutral { background: rgba(139, 148, 158, 0.15); color: var(--text-muted); border: 1px solid var(--card-border); }

    .live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid var(--card-border);
      background: rgba(139, 148, 158, 0.1);
      color: var(--text-muted);
      letter-spacing: 0.5px;
      user-select: none;
    }

    .live-indicator .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-muted);
    }

    .live-indicator.connected {
      border-color: var(--success);
      color: var(--success);
      background: rgba(63, 185, 80, 0.1);
    }

    .live-indicator.connected .dot {
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
      animation: pulse-dot 2s infinite ease-in-out;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .grid-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
    }

    .stat-card .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .stat-card .value {
      font-size: 22px;
      font-weight: 700;
      color: #f0f6fc;
      font-family: var(--font-mono);
    }

    .golden-box {
      background: rgba(210, 153, 34, 0.08);
      border: 1px solid var(--warning);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }

    .golden-box h3 {
      font-size: 14px;
      font-weight: 700;
      color: var(--warning);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .filter-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-btn {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .filter-btn:hover, .filter-btn.active {
      background: var(--accent);
      color: #0d1117;
      border-color: var(--accent);
      font-weight: 600;
    }

    .search-input {
      margin-left: auto;
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      color: var(--text);
      padding: 6px 12px;
      font-size: 13px;
      width: 250px;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .timeline {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .event-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.15s ease, transform 0.2s ease;
    }

    .event-card:hover {
      border-color: #58a6ff66;
    }

    .event-card.new-flash {
      border-color: var(--accent);
      box-shadow: 0 0 10px rgba(88, 166, 255, 0.3);
    }

    .event-header {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.02);
      cursor: pointer;
      user-select: none;
    }

    .event-index {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      min-width: 28px;
    }

    .event-time {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .event-type {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
    }

    .type-tool { background: rgba(88, 166, 255, 0.15); color: var(--accent); }
    .type-prompt { background: rgba(188, 140, 255, 0.15); color: var(--purple); }
    .type-file { background: rgba(63, 185, 80, 0.15); color: var(--success); }
    .type-session { background: rgba(139, 148, 158, 0.15); color: var(--text-muted); }

    .event-title {
      font-weight: 600;
      font-size: 14px;
      color: #f0f6fc;
      flex-grow: 1;
    }

    .event-duration {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .event-body {
      padding: 16px;
      border-top: 1px solid var(--card-border);
      display: none;
    }

    .event-card.expanded .event-body {
      display: block;
    }

    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
      color: #e6edf3;
      max-height: 400px;
      overflow-y: auto;
    }

    .section-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
      font-weight: 600;
    }

    /* File Diff Viewer Styling */
    .file-diff-box {
      margin-top: 12px;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--code-bg);
    }

    .diff-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #12161f;
      border-bottom: 1px solid var(--card-border);
      font-size: 12px;
    }

    .diff-filename {
      font-weight: 600;
      font-family: var(--font-mono);
      color: #f0f6fc;
    }

    .diff-badges {
      display: flex;
      gap: 6px;
    }

    .diff-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
    }

    .diff-badge-add { background: rgba(63, 185, 80, 0.2); color: var(--success); }
    .diff-badge-del { background: rgba(248, 81, 73, 0.2); color: var(--danger); }
    .diff-badge-trunc { background: rgba(210, 153, 34, 0.2); color: var(--warning); }

    .diff-code-container {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
      overflow-x: auto;
      max-height: 380px;
      overflow-y: auto;
    }

    .diff-line {
      display: flex;
      padding: 1px 8px;
      white-space: pre;
    }

    .diff-gutter {
      width: 20px;
      flex-shrink: 0;
      user-select: none;
      color: var(--text-muted);
      text-align: center;
    }

    .diff-content {
      flex-grow: 1;
    }

    .diff-add {
      background: rgba(63, 185, 80, 0.12);
      color: #7ee787;
    }

    .diff-add .diff-gutter {
      color: var(--success);
      font-weight: 700;
    }

    .diff-del {
      background: rgba(248, 81, 73, 0.12);
      color: #ffa198;
    }

    .diff-del .diff-gutter {
      color: var(--danger);
      font-weight: 700;
    }

    .diff-hunk {
      background: rgba(188, 140, 255, 0.08);
      color: var(--purple);
      font-style: italic;
    }

    .diff-file-header {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
    }

    .diff-context {
      color: var(--text);
    }

    .diff-truncated {
      color: var(--warning);
      font-style: italic;
      background: rgba(210, 153, 34, 0.08);
      padding: 4px 8px;
    }

    footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>TraceEval 🔍</h1>
      <span class="tagline">Trajectory & Regression Inspector</span>
    </div>
    <div class="header-actions">
      <span id="live-indicator" class="live-indicator ${isLive ? 'connected' : ''}" title="Real-time Server-Sent Events stream">
        <span class="dot"></span>
        <span id="live-text">${isLive ? 'LIVE' : 'OFFLINE'}</span>
      </span>
      <span id="status-badge" class="badge ${session.status === 'completed' ? 'badge-success' : (session.status === 'error' ? 'badge-error' : 'badge-active')}">
        ${escapeHtml(session.status)}
      </span>
    </div>
  </header>

  <div class="grid-summary">
    <div class="stat-card">
      <div class="label">Session ID</div>
      <div class="value" style="font-size: 14px; word-break: break-all;">${escapeHtml(session.id)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Agent</div>
      <div class="value">${escapeHtml(session.agent)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Steps</div>
      <div class="value" id="stat-steps">${toolCalls.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Duration</div>
      <div class="value" id="stat-duration">${escapeHtml(durationStr)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Events Recorded</div>
      <div class="value" id="stat-events">${session.events.length}</div>
    </div>
    ${totalCost > 0 ? `
    <div class="stat-card">
      <div class="label">Cost (USD)</div>
      <div class="value">$${totalCost.toFixed(4)}</div>
    </div>` : ''}
    ${totalTokens > 0 ? `
    <div class="stat-card">
      <div class="label">Total Tokens</div>
      <div class="value">${totalTokens.toLocaleString()}</div>
    </div>` : ''}
  </div>

  ${golden ? `
  <div class="golden-box">
    <h3>🏆 Golden Baseline: ${escapeHtml(golden.testName)}</h3>
    <div style="font-size: 13px; color: var(--text); line-height: 1.6;">
      <strong>Baseline Steps:</strong> ${golden.stepCount} | 
      <strong>Current Steps:</strong> ${toolCalls.length} 
      ${diff ? `(${diff.stepDelta >= 0 ? '+' : ''}${diff.stepDelta} steps, ${diff.stepPercentDelta >= 0 ? '+' : ''}${diff.stepPercentDelta}%)` : ''} | 
      <strong>Baseline Duration:</strong> ${golden.durationMs}ms | 
      <strong>Current Duration:</strong> ${durationStr}
      ${diff && diff.isRegression ? `<br><strong style="color: var(--danger);">⚠ Regression Warning:</strong> ${escapeHtml(diff.regressionReasons.join(", "))}` : ''}
    </div>
  </div>` : ''}

  <div class="filter-bar">
    <button class="filter-btn active" data-filter="all" id="btn-filter-all">All Events (<span id="count-all">${session.events.length}</span>)</button>
    <button class="filter-btn" data-filter="tool" id="btn-filter-tool">Tool Calls (<span id="count-tool">${toolCalls.length}</span>)</button>
    <button class="filter-btn" data-filter="file" id="btn-filter-file">File Changes (<span id="count-file">${fileChanges.length}</span>)</button>
    <button class="filter-btn" data-filter="prompt">Prompts</button>
    <button class="filter-btn" onclick="toggleAll()">Expand/Collapse All</button>
    <input type="text" class="search-input" id="search" placeholder="Search event payload...">
  </div>

  <div class="timeline" id="timeline">
    ${session.events.map((evt, idx) => renderEventCardHtml(evt, idx + 1)).join("")}
  </div>

  <footer>
    <span>Generated by TraceEval v0.0.3 (Local & Privacy-First)</span>
    <span>Real-time SSE Event Streaming & SQLite Indexing</span>
  </footer>

  <script>
    function toggleCard(headerEl) {
      const card = headerEl.closest('.event-card');
      card.classList.toggle('expanded');
    }

    let allExpanded = false;
    function toggleAll() {
      allExpanded = !allExpanded;
      document.querySelectorAll('.event-card').forEach(c => {
        if (allExpanded) c.classList.add('expanded');
        else c.classList.remove('expanded');
      });
    }

    // Filter Buttons
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.getAttribute('data-filter');
        document.querySelectorAll('.event-card').forEach(card => {
          if (filter === 'all' || card.getAttribute('data-category') === filter) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });

    // Search filter
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('.event-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(term)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });

    // Real-Time Server-Sent Events (SSE) streaming
    if (window.location.protocol.startsWith('http')) {
      const currentSessionId = "${escapeHtml(session.id)}";
      const sseUrl = '/events?sessionId=' + encodeURIComponent(currentSessionId);
      const evtSource = new EventSource(sseUrl);

      const liveInd = document.getElementById('live-indicator');
      const liveText = document.getElementById('live-text');

      evtSource.onopen = () => {
        if (liveInd) liveInd.classList.add('connected');
        if (liveText) liveText.textContent = 'LIVE';
      };

      evtSource.onerror = () => {
        if (liveInd) liveInd.classList.remove('connected');
        if (liveText) liveText.textContent = 'RECONNECTING';
      };

      let currentEventCount = ${session.events.length};
      let currentStepCount = ${toolCalls.length};
      let currentFileCount = ${fileChanges.length};

      evtSource.addEventListener('trace_event', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (!payload || !payload.id) return;

          // Deduplicate if already present
          if (document.querySelector('.event-card[data-event-id="' + payload.id + '"]')) {
            return;
          }

          currentEventCount++;
          const isTool = payload.type === 'tool_call' || payload.type === 'tool_call_start';
          const isFile = payload.type === 'file_change';
          if (isTool) currentStepCount++;
          if (isFile) currentFileCount++;

          // Update header counters
          const statEvents = document.getElementById('stat-events');
          if (statEvents) statEvents.textContent = currentEventCount;

          const statSteps = document.getElementById('stat-steps');
          if (statSteps) statSteps.textContent = currentStepCount;

          const countAll = document.getElementById('count-all');
          if (countAll) countAll.textContent = currentEventCount;

          const countTool = document.getElementById('count-tool');
          if (countTool) countTool.textContent = currentStepCount;

          const countFile = document.getElementById('count-file');
          if (countFile) countFile.textContent = currentFileCount;

          // If session end event arrived, update status badge
          if (payload.type === 'session_end') {
            const badge = document.getElementById('status-badge');
            if (badge) {
              const status = payload.data?.status || 'completed';
              badge.textContent = status;
              badge.className = 'badge ' + (status === 'error' ? 'badge-error' : 'badge-success');
            }
          }

          // Append new card into DOM
          const timeline = document.getElementById('timeline');
          if (timeline && payload.html) {
            const temp = document.createElement('div');
            temp.innerHTML = payload.html.trim();
            const newCard = temp.firstElementChild;
            if (newCard) {
              newCard.classList.add('new-flash');
              timeline.appendChild(newCard);
              setTimeout(() => newCard.classList.remove('new-flash'), 2000);
            }
          }
        } catch (err) {
          console.error('[TraceEval SSE error]', err);
        }
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Helper to render individual event card HTML string.
 */
export function renderEventCardHtml(evt: TraceEvent, index: number): string {
  const isTool = evt.type === "tool_call" || evt.type === "tool_call_start";
  const isFile = evt.type === "file_change";
  const isPrompt = evt.type === "user_prompt";
  const category = isTool ? "tool" : (isFile ? "file" : (isPrompt ? "prompt" : "session"));
  const time = evt.timestamp.split("T")[1]?.slice(0, 8) || evt.timestamp;

  let title = "";
  if (isTool) {
    const toolName = evt.data?.toolName || evt.data?.tool || evt.data?.name || "Tool";
    title = `Tool Call: ${escapeHtml(toolName)}`;
  } else if (isFile) {
    title = `File Change: ${escapeHtml(evt.data?.path || "File")}`;
  } else if (isPrompt) {
    const promptPreview = String(evt.data?.prompt || "").slice(0, 70);
    title = `User Prompt: "${escapeHtml(promptPreview)}..."`;
  } else {
    title = `Event: ${escapeHtml(evt.type)}`;
  }

  const durationMs = evt.data?.durationMs as number | undefined;
  const parsedDiff = extractDiffFromEvent(evt);

  return `
  <div class="event-card" data-category="${category}" data-event-id="${escapeHtml(evt.id)}">
    <div class="event-header" onclick="toggleCard(this)">
      <span class="event-index">#${index}</span>
      <span class="event-time">${escapeHtml(time)}</span>
      <span class="event-type type-${category}">${escapeHtml(evt.type)}</span>
      <span class="event-title">${title}</span>
      ${durationMs !== undefined ? `<span class="event-duration">${durationMs}ms</span>` : ''}
      ${evt.data?.status ? `<span class="badge ${evt.data.status === 'success' ? 'badge-success' : 'badge-error'}">${escapeHtml(evt.data.status)}</span>` : ''}
    </div>
    <div class="event-body">
      ${evt.data?.input ? `
        <div class="section-label">Input Payload</div>
        <pre class="code-block">${escapeHtml(evt.data.input)}</pre>
      ` : ''}
      ${parsedDiff ? `
        <div class="section-label" style="margin-top: 12px;">Visual File Diff</div>
        ${renderDiffHtml(parsedDiff)}
      ` : ''}
      ${evt.data?.output !== undefined && !parsedDiff ? `
        <div class="section-label" style="margin-top: 12px;">Result / Output</div>
        <pre class="code-block">${escapeHtml(evt.data.output)}</pre>
      ` : ''}
      ${!evt.data?.input && evt.data?.output === undefined && !parsedDiff ? `
        <div class="section-label">Full Event Data</div>
        <pre class="code-block">${escapeHtml(evt.data)}</pre>
      ` : ''}
    </div>
  </div>`;
}
