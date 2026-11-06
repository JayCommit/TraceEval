import { TraceSession, GoldenBaseline, RegressionDiff } from "../types/index.js";

export interface ViewerOptions {
  golden?: GoldenBaseline | null;
  diff?: RegressionDiff | null;
  sessionsList?: Array<{ id: string; agent: string; startTime: string; status: string; eventCount: number }>;
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
  const { golden, diff, sessionsList = [] } = options;

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
      transition: border-color 0.15s ease;
    }

    .event-card:hover {
      border-color: #58a6ff66;
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
    <div>
      <span class="badge ${session.status === 'completed' ? 'badge-success' : (session.status === 'error' ? 'badge-error' : 'badge-active')}">
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
      <div class="value">${toolCalls.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Duration</div>
      <div class="value">${escapeHtml(durationStr)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Events Recorded</div>
      <div class="value">${session.events.length}</div>
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
    <button class="filter-btn active" data-filter="all">All Events (${session.events.length})</button>
    <button class="filter-btn" data-filter="tool">Tool Calls (${toolCalls.length})</button>
    <button class="filter-btn" data-filter="file">File Changes (${fileChanges.length})</button>
    <button class="filter-btn" data-filter="prompt">Prompts</button>
    <button class="filter-btn" onclick="toggleAll()">Expand/Collapse All</button>
    <input type="text" class="search-input" id="search" placeholder="Search event payload...">
  </div>

  <div class="timeline" id="timeline">
    ${session.events.map((evt, idx) => {
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

      return `
      <div class="event-card" data-category="${category}">
        <div class="event-header" onclick="toggleCard(this)">
          <span class="event-index">#${idx + 1}</span>
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
          ${evt.data?.output !== undefined ? `
            <div class="section-label" style="margin-top: 12px;">Result / Output</div>
            <pre class="code-block">${escapeHtml(evt.data.output)}</pre>
          ` : ''}
          ${!evt.data?.input && evt.data?.output === undefined ? `
            <div class="section-label">Full Event Data</div>
            <pre class="code-block">${escapeHtml(evt.data)}</pre>
          ` : ''}
        </div>
      </div>
      `;
    }).join("")}
  </div>

  <footer>
    <span>Generated by TraceEval v0.0.1 (Local & Privacy-First)</span>
    <span>Local SQLite & JSONL Storage</span>
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
  </script>
</body>
</html>`;
}
