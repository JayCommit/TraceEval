import { TraceSession, GoldenBaseline, RegressionDiff, TraceEvent } from "../types/index.js";
import { extractDiffFromEvent, renderDiffHtml } from "./diff.js";
import { VIEWER_CSS } from "./styles.js";

export * from "./diff.js";
export * from "./styles.js";

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

function safeScriptJson(val: unknown): string {
  return JSON.stringify(val)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/**
 * Generates interactive HTML report for a single trace session.
 */
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
    ${VIEWER_CSS}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>TraceEval 🔍</h1>
      <span class="tagline">Trajectory & Regression Inspector</span>
    </div>
    <div class="header-actions">
      ${options.sessionsList && options.sessionsList.length > 1 ? `
      <div class="arena-launch-control">
        <select class="arena-select" onchange="if(this.value) window.location.href = '/?sessions=${escapeHtml(session.id)},' + encodeURIComponent(this.value)">
          <option value="">⚔️ Arena Mode (Compare Agents)...</option>
          ${options.sessionsList.filter(s => s.id !== session.id).map(s => `<option value="${escapeHtml(s.id)}">vs ${escapeHtml(s.agent)} (${escapeHtml(s.id.length > 18 ? s.id.slice(0, 16) + '…' : s.id)})</option>`).join("")}
        </select>
      </div>` : ''}
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

  <div class="session-control-bar" id="control-bar-${escapeHtml(session.id)}" data-session-id="${escapeHtml(session.id)}">
    <div class="control-bar-left">
      <span class="control-bar-title">⚡ Session Control</span>
      <button type="button" class="ctrl-btn ctrl-btn-pause" id="btn-pause-${escapeHtml(session.id)}" onclick="controlSession('${escapeHtml(session.id)}', 'pause')">⏸ Pause</button>
      <button type="button" class="ctrl-btn ctrl-btn-abort" id="btn-abort-${escapeHtml(session.id)}" onclick="controlSession('${escapeHtml(session.id)}', 'abort')">⏹ Abort</button>
    </div>
    <div class="control-bar-right">
      <input type="text" class="ctrl-inject-input" id="inject-input-${escapeHtml(session.id)}" placeholder="Inject prompt / steering message..." onkeydown="if(event.key==='Enter') injectSessionPrompt('${escapeHtml(session.id)}')" />
      <button type="button" class="ctrl-btn ctrl-btn-inject" onclick="injectSessionPrompt('${escapeHtml(session.id)}')">Inject</button>
    </div>
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
    <span>Generated by TraceEval v0.0.7 (Local & Privacy-First)</span>
    <span>Real-time SSE Event Streaming & SQLite Indexing</span>
  </footer>

  <script>
    function toggleDiffView(btn, mode, event) {
      if (event) event.stopPropagation();
      const box = btn.closest('.file-diff-box');
      if (!box) return;
      box.classList.remove('view-split', 'view-unified');
      box.classList.add('view-' + mode);
      box.querySelectorAll('.diff-toggle-btn').forEach(b => {
        if (b.getAttribute('data-mode') === mode) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    window.toggleDiffView = toggleDiffView;

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
      const currentSessionId = ${safeScriptJson(session.id)};
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

      function handleIncomingTraceEvent(payload) {
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

        // Dynamic status updates on control events
        const badge = document.getElementById('status-badge');
        const btnPause = document.getElementById('btn-pause-${escapeHtml(session.id)}');
        const btnAbort = document.getElementById('btn-abort-${escapeHtml(session.id)}');

        if (payload.type === 'session_pause') {
          if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-paused'; }
          if (btnPause) { btnPause.textContent = '▶ Resume'; btnPause.classList.add('resumed'); }
          showToast('Session paused');
        } else if (payload.type === 'session_resume') {
          if (badge) { badge.textContent = 'ACTIVE'; badge.className = 'badge badge-active'; }
          if (btnPause) { btnPause.textContent = '⏸ Pause'; btnPause.classList.remove('resumed'); }
          showToast('Session resumed');
        } else if (payload.type === 'session_abort') {
          if (badge) { badge.textContent = 'ABORTED'; badge.className = 'badge badge-aborted'; }
          if (btnPause) btnPause.disabled = true;
          if (btnAbort) btnAbort.disabled = true;
          showToast('Session aborted');
        } else if (payload.type === 'session_end') {
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
      }

      evtSource.addEventListener('trace_event', (e) => {
        try {
          const payload = JSON.parse(e.data);
          handleIncomingTraceEvent(payload);
        } catch (err) {
          console.error('[TraceEval SSE error]', err);
        }
      });

      // WebSocket bidirectional stream & control
      let ws = null;
      function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/ws' + window.location.search;
        try {
          ws = new WebSocket(wsUrl);
          ws.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.event === 'trace_event' && msg.data) {
                handleIncomingTraceEvent(msg.data);
              }
            } catch (err) {}
          };
          ws.onclose = () => { setTimeout(initWebSocket, 4000); };
        } catch (err) {}
      }
      initWebSocket();
    }

    function showToast(message) {
      let toast = document.getElementById('ctrl-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ctrl-toast';
        toast.className = 'ctrl-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
    window.showToast = showToast;

    function getControlUrl() {
      const token = new URLSearchParams(window.location.search).get('token');
      return token ? '/api/control?token=' + encodeURIComponent(token) : '/api/control';
    }

    async function controlSession(sessionId, action) {
      const btnPause = document.getElementById('btn-pause-' + sessionId);
      const isCurrentlyPaused = btnPause && btnPause.classList.contains('resumed');
      const effectiveAction = (action === 'pause' && isCurrentlyPaused) ? 'resume' : action;

      try {
        const res = await fetch(getControlUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: effectiveAction, sessionId })
        });
        const data = await res.json();
        if (data.success) {
          if (effectiveAction === 'pause') {
            if (btnPause) { btnPause.textContent = '▶ Resume'; btnPause.classList.add('resumed'); }
            const badge = document.getElementById('status-badge');
            if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-paused'; }
          } else if (effectiveAction === 'resume') {
            if (btnPause) { btnPause.textContent = '⏸ Pause'; btnPause.classList.remove('resumed'); }
            const badge = document.getElementById('status-badge');
            if (badge) { badge.textContent = 'ACTIVE'; badge.className = 'badge badge-active'; }
          } else if (effectiveAction === 'abort') {
            const btnAbort = document.getElementById('btn-abort-' + sessionId);
            if (btnAbort) btnAbort.disabled = true;
            if (btnPause) btnPause.disabled = true;
            const badge = document.getElementById('status-badge');
            if (badge) { badge.textContent = 'ABORTED'; badge.className = 'badge badge-aborted'; }
          }
          showToast('Session ' + effectiveAction + ' command sent');
        } else {
          showToast('Control error: ' + (data.error || 'Failed'));
        }
      } catch (err) {
        showToast('Control error: ' + err.message);
      }
    }
    window.controlSession = controlSession;

    async function injectSessionPrompt(sessionId) {
      const input = document.getElementById('inject-input-' + sessionId);
      if (!input) return;
      const prompt = input.value.trim();
      if (!prompt) return;

      try {
        const res = await fetch(getControlUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'inject', sessionId, message: prompt })
        });
        const data = await res.json();
        if (data.success) {
          input.value = '';
          showToast('Prompt injected into session');
        } else {
          showToast('Injection error: ' + (data.error || 'Failed'));
        }
      } catch (err) {
        showToast('Injection error: ' + err.message);
      }
    }
    window.injectSessionPrompt = injectSessionPrompt;
  </script>
</body>
</html>`;
}

/**
 * Generates the Multi-Agent Live Arena HTML view comparing multiple agent trajectories side-by-side.
 */
export function generateArenaHtml(sessions: TraceSession[], options: ViewerOptions = {}): string {
  const { isLive = false, sessionsList = [] } = options;
  const currentIds = new Set(sessions.map((s) => s.id));
  const availableToAdd = sessionsList.filter((s) => !currentIds.has(s.id));

  // Compute metrics per session
  const sessionSummaries = sessions.map((s) => {
    const toolCalls = s.events.filter((e) => e.type === "tool_call" || e.type === "tool_call_start");
    const fileChanges = s.events.filter((e) => e.type === "file_change");
    const totalCost = (s.metadata?.cost ?? s.metadata?.totalCost ?? 0) as number;
    const totalTokens = (s.metadata?.tokens ?? s.metadata?.totalTokens ?? 0) as number;
    const durationStr = s.durationMs !== undefined
      ? `${s.durationMs}ms`
      : (s.endTime ? `${new Date(s.endTime).getTime() - new Date(s.startTime).getTime()}ms` : "In progress");

    return {
      session: s,
      toolCalls,
      fileChanges,
      totalCost,
      totalTokens,
      durationStr,
    };
  });

  // Calculate comparison deltas if 2 sessions
  let diffSummaryHtml = "";
  if (sessionSummaries.length === 2) {
    const s0 = sessionSummaries[0];
    const s1 = sessionSummaries[1];
    const stepDiff = s1.toolCalls.length - s0.toolCalls.length;
    const stepText = stepDiff === 0
      ? "Equal steps"
      : (stepDiff > 0
          ? `${s0.session.agent} was more step-efficient (-${stepDiff} steps)`
          : `${s1.session.agent} was more step-efficient (-${Math.abs(stepDiff)} steps)`);

    const dur0Ms = s0.session.durationMs || 0;
    const dur1Ms = s1.session.durationMs || 0;
    let durText = "";
    if (dur0Ms > 0 && dur1Ms > 0) {
      const durDiff = dur1Ms - dur0Ms;
      durText = durDiff === 0
        ? "Identical duration"
        : (durDiff > 0
            ? `${s0.session.agent} finished faster (${durDiff}ms quicker)`
            : `${s1.session.agent} finished faster (${Math.abs(durDiff)}ms quicker)`);
    }

    diffSummaryHtml = `
    <div class="scoreboard-card scoreboard-diff-card">
      <div class="scoreboard-card-header">
        <strong style="color: var(--accent); font-size: 13px;">⚔️ Direct Head-to-Head Delta</strong>
        <span class="badge badge-active">Arena Delta</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; margin-top: 6px;">
        <div class="diff-item"><span>Efficiency:</span><strong>${escapeHtml(stepText)}</strong></div>
        ${durText ? `<div class="diff-item"><span>Speed:</span><strong>${escapeHtml(durText)}</strong></div>` : ""}
        <div class="diff-item"><span>Files Touched:</span><span>${escapeHtml(s0.session.agent)}: <strong>${s0.fileChanges.length}</strong> | ${escapeHtml(s1.session.agent)}: <strong>${s1.fileChanges.length}</strong></span></div>
      </div>
    </div>`;
  }

  // Render Scoreboard
  const scoreboardHtml = `
  <div class="arena-scoreboard">
    ${sessionSummaries.map((info) => `
      <div class="scoreboard-card">
        <div class="scoreboard-card-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="agent-tag agent-${info.session.agent.toLowerCase()}">${escapeHtml(info.session.agent)}</span>
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);">${escapeHtml(info.session.id.length > 18 ? info.session.id.slice(0, 16) + '…' : info.session.id)}</span>
          </div>
          <span class="badge ${info.session.status === 'completed' ? 'badge-success' : (info.session.status === 'error' ? 'badge-error' : 'badge-active')}">
            ${escapeHtml(info.session.status)}
          </span>
        </div>
        <div class="scoreboard-metrics">
          <div>
            <div class="scoreboard-metric-label">Steps</div>
            <div class="scoreboard-metric-val" id="score-steps-${escapeHtml(info.session.id)}">${info.toolCalls.length}</div>
          </div>
          <div>
            <div class="scoreboard-metric-label">Duration</div>
            <div class="scoreboard-metric-val" id="score-duration-${escapeHtml(info.session.id)}">${escapeHtml(info.durationStr)}</div>
          </div>
          <div>
            <div class="scoreboard-metric-label">Files</div>
            <div class="scoreboard-metric-val" id="score-files-${escapeHtml(info.session.id)}">${info.fileChanges.length}</div>
          </div>
        </div>
        ${info.totalCost > 0 || info.totalTokens > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--card-border); font-size: 11px; color: var(--text-muted);">
          <span>Cost: <strong style="color: #f0f6fc;">$${info.totalCost.toFixed(4)}</strong></span>
          <span>Tokens: <strong style="color: #f0f6fc;">${info.totalTokens.toLocaleString()}</strong></span>
        </div>` : ""}
      </div>
    `).join("")}
    ${diffSummaryHtml}
  </div>`;

  // Render Panes
  const columnsCount = Math.min(Math.max(sessionSummaries.length, 1), 4);
  const panesHtml = sessionSummaries.map((info) => `
    <div class="arena-pane" id="pane-${escapeHtml(info.session.id)}" data-session-id="${escapeHtml(info.session.id)}">
      <div class="arena-pane-header">
        <div class="arena-pane-agent">
          <span class="agent-tag agent-${info.session.agent.toLowerCase()}">${escapeHtml(info.session.agent)}</span>
          <span class="arena-pane-id" title="${escapeHtml(info.session.id)}">${escapeHtml(info.session.id)}</span>
        </div>
        <div class="arena-pane-meta">
          <span id="badge-${escapeHtml(info.session.id)}" class="badge ${info.session.status === 'completed' ? 'badge-success' : (info.session.status === 'error' ? 'badge-error' : 'badge-active')}">
            ${escapeHtml(info.session.status)}
          </span>
          <button type="button" class="arena-unpin-btn" onclick="removeSession('${escapeHtml(info.session.id)}')" title="Remove agent from Arena">✕</button>
        </div>
      </div>
      <div class="arena-pane-subbar">
        <span><strong id="steps-${escapeHtml(info.session.id)}">${info.toolCalls.length}</strong> steps</span>
        <span>•</span>
        <span id="duration-${escapeHtml(info.session.id)}">${escapeHtml(info.durationStr)}</span>
        <span>•</span>
        <span><strong id="files-${escapeHtml(info.session.id)}">${info.fileChanges.length}</strong> files</span>
        <span>•</span>
        <span><strong id="events-${escapeHtml(info.session.id)}">${info.session.events.length}</strong> events</span>
        <input type="text" class="pane-search" placeholder="Filter ${escapeHtml(info.session.agent)}..." oninput="filterPane('${escapeHtml(info.session.id)}', this.value)">
      </div>
      <div class="arena-control-bar" id="control-bar-${escapeHtml(info.session.id)}">
        <button type="button" class="ctrl-btn ctrl-btn-sm ctrl-btn-pause" id="btn-pause-${escapeHtml(info.session.id)}" onclick="controlSession('${escapeHtml(info.session.id)}', 'pause')">⏸ Pause</button>
        <button type="button" class="ctrl-btn ctrl-btn-sm ctrl-btn-abort" id="btn-abort-${escapeHtml(info.session.id)}" onclick="controlSession('${escapeHtml(info.session.id)}', 'abort')">⏹ Abort</button>
        <input type="text" class="ctrl-inject-input ctrl-inject-sm" id="inject-input-${escapeHtml(info.session.id)}" placeholder="Inject prompt..." onkeydown="if(event.key==='Enter') injectSessionPrompt('${escapeHtml(info.session.id)}')" />
        <button type="button" class="ctrl-btn ctrl-btn-sm ctrl-btn-inject" onclick="injectSessionPrompt('${escapeHtml(info.session.id)}')">Inject</button>
      </div>
      <div class="timeline" id="timeline-${escapeHtml(info.session.id)}">
        ${info.session.events.map((evt, idx) => renderEventCardHtml(evt, idx + 1)).join("")}
      </div>
    </div>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TraceEval ⚔️ Arena — Multi-Agent Live Trajectory Comparator</title>
  <style>
    ${VIEWER_CSS}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>TraceEval ⚔️ Arena</h1>
      <span class="tagline">Multi-Agent Live Trajectory Comparator</span>
    </div>
    <div class="header-actions">
      ${availableToAdd.length > 0 ? `
      <select class="arena-select" onchange="if(this.value) addSession(this.value)">
        <option value="">+ Add Agent to Arena...</option>
        ${availableToAdd.map(s => `<option value="${escapeHtml(s.id)}">+ ${escapeHtml(s.agent)} (${escapeHtml(s.id.length > 18 ? s.id.slice(0, 16) + '…' : s.id)})</option>`).join("")}
      </select>` : ''}
      <a href="/?sessionId=${encodeURIComponent(sessions[0].id)}" style="color: var(--accent); font-size: 12px; text-decoration: none; padding: 4px 10px; border: 1px solid var(--card-border); border-radius: 6px; font-weight: 600;">Single View</a>
      <span id="live-indicator" class="live-indicator ${isLive ? 'connected' : ''}" title="Real-time Server-Sent Events stream">
        <span class="dot"></span>
        <span id="live-text">${isLive ? 'LIVE' : 'OFFLINE'}</span>
      </span>
      <span class="badge badge-active">${sessions.length} Agents</span>
    </div>
  </header>

  ${scoreboardHtml}

  <div class="arena-columns" style="grid-template-columns: repeat(${columnsCount}, minmax(420px, 1fr));">
    ${panesHtml}
  </div>

  <footer>
    <span>Generated by TraceEval v0.0.7 (Local & Privacy-First) • Multi-Agent Live Arena</span>
    <span>Side-by-side agent comparison with real-time SSE streaming</span>
  </footer>

  <script>
    function toggleDiffView(btn, mode, event) {
      if (event) event.stopPropagation();
      const box = btn.closest('.file-diff-box');
      if (!box) return;
      box.classList.remove('view-split', 'view-unified');
      box.classList.add('view-' + mode);
      box.querySelectorAll('.diff-toggle-btn').forEach(b => {
        if (b.getAttribute('data-mode') === mode) b.classList.add('active');
        else b.classList.remove('active');
      });
    }
    window.toggleDiffView = toggleDiffView;

    function toggleCard(headerEl) {
      const card = headerEl.closest('.event-card');
      card.classList.toggle('expanded');
    }

    function addSession(newId) {
      if (!newId) return;
      const params = new URLSearchParams(window.location.search);
      let list = params.get('sessions')
        ? params.get('sessions').split(',').map(s => s.trim()).filter(Boolean)
        : [${sessions.map((s) => safeScriptJson(s.id)).join(",")}];
      if (!list.includes(newId)) {
        list.push(newId);
        params.set('sessions', list.join(','));
        window.location.search = params.toString();
      }
    }
    window.addSession = addSession;

    function removeSession(id) {
      const params = new URLSearchParams(window.location.search);
      let list = params.get('sessions')
        ? params.get('sessions').split(',').map(s => s.trim()).filter(Boolean)
        : [${sessions.map((s) => safeScriptJson(s.id)).join(",")}];
      list = list.filter(s => s !== id);
      if (list.length > 0) {
        params.set('sessions', list.join(','));
        window.location.search = params.toString();
      } else {
        window.location.href = '/';
      }
    }
    window.removeSession = removeSession;

    function filterPane(sessionId, term) {
      const t = (term || '').toLowerCase();
      const timeline = document.getElementById('timeline-' + sessionId);
      if (!timeline) return;
      timeline.querySelectorAll('.event-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(t)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
    window.filterPane = filterPane;

    // Real-Time Server-Sent Events (SSE) streaming
    if (window.location.protocol.startsWith('http')) {
      const evtSource = new EventSource('/events' + window.location.search);
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

      evtSource.addEventListener('trace_event', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (!payload || !payload.id || !payload.sessionId) return;

          // Deduplicate if card already exists
          if (document.querySelector('.event-card[data-event-id="' + payload.id + '"]')) return;

          const sid = payload.sessionId;
          const timeline = document.getElementById('timeline-' + sid);
          if (!timeline) return;

          const isTool = payload.type === 'tool_call' || payload.type === 'tool_call_start';
          const isFile = payload.type === 'file_change';

          const stepsEl = document.getElementById('steps-' + sid);
          if (stepsEl && isTool) {
            stepsEl.textContent = String(parseInt(stepsEl.textContent || '0', 10) + 1);
          }
          const scoreStepsEl = document.getElementById('score-steps-' + sid);
          if (scoreStepsEl && isTool) {
            scoreStepsEl.textContent = String(parseInt(scoreStepsEl.textContent || '0', 10) + 1);
          }

          const filesEl = document.getElementById('files-' + sid);
          if (filesEl && isFile) {
            filesEl.textContent = String(parseInt(filesEl.textContent || '0', 10) + 1);
          }
          const scoreFilesEl = document.getElementById('score-files-' + sid);
          if (scoreFilesEl && isFile) {
            scoreFilesEl.textContent = String(parseInt(scoreFilesEl.textContent || '0', 10) + 1);
          }

          const eventsEl = document.getElementById('events-' + sid);
          if (eventsEl) {
            eventsEl.textContent = String(parseInt(eventsEl.textContent || '0', 10) + 1);
          }

          if (payload.type === 'session_pause') {
            const badge = document.getElementById('badge-' + sid);
            const btnPause = document.getElementById('btn-pause-' + sid);
            if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-paused'; }
            if (btnPause) { btnPause.textContent = '▶ Resume'; btnPause.classList.add('resumed'); }
            showToast('Agent ' + sid.slice(0, 8) + ' paused');
          } else if (payload.type === 'session_resume') {
            const badge = document.getElementById('badge-' + sid);
            const btnPause = document.getElementById('btn-pause-' + sid);
            if (badge) { badge.textContent = 'ACTIVE'; badge.className = 'badge badge-active'; }
            if (btnPause) { btnPause.textContent = '⏸ Pause'; btnPause.classList.remove('resumed'); }
            showToast('Agent ' + sid.slice(0, 8) + ' resumed');
          } else if (payload.type === 'session_abort') {
            const badge = document.getElementById('badge-' + sid);
            const btnAbort = document.getElementById('btn-abort-' + sid);
            const btnPause = document.getElementById('btn-pause-' + sid);
            if (badge) { badge.textContent = 'ABORTED'; badge.className = 'badge badge-aborted'; }
            if (btnAbort) btnAbort.disabled = true;
            if (btnPause) btnPause.disabled = true;
            showToast('Agent ' + sid.slice(0, 8) + ' aborted');
          } else if (payload.type === 'session_end') {
            const badge = document.getElementById('badge-' + sid);
            if (badge) {
              const status = payload.data?.status || 'completed';
              badge.textContent = status;
              badge.className = 'badge ' + (status === 'error' ? 'badge-error' : 'badge-success');
            }
          }

          if (payload.html) {
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
          console.error('[TraceEval Arena SSE error]', err);
        }
      });

      // WebSocket bidirectional stream & control
      let ws = null;
      function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/ws' + window.location.search;
        try {
          ws = new WebSocket(wsUrl);
          ws.onclose = () => { setTimeout(initWebSocket, 4000); };
        } catch (err) {}
      }
      initWebSocket();
    }

    function showToast(message) {
      let toast = document.getElementById('ctrl-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ctrl-toast';
        toast.className = 'ctrl-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }
    window.showToast = showToast;

    function getControlUrl() {
      const token = new URLSearchParams(window.location.search).get('token');
      return token ? '/api/control?token=' + encodeURIComponent(token) : '/api/control';
    }

    async function controlSession(sessionId, action) {
      const btnPause = document.getElementById('btn-pause-' + sessionId);
      const isCurrentlyPaused = btnPause && btnPause.classList.contains('resumed');
      const effectiveAction = (action === 'pause' && isCurrentlyPaused) ? 'resume' : action;

      try {
        const res = await fetch(getControlUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: effectiveAction, sessionId })
        });
        const data = await res.json();
        if (data.success) {
          if (effectiveAction === 'pause') {
            if (btnPause) { btnPause.textContent = '▶ Resume'; btnPause.classList.add('resumed'); }
            const badge = document.getElementById('badge-' + sessionId);
            if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-paused'; }
          } else if (effectiveAction === 'resume') {
            if (btnPause) { btnPause.textContent = '⏸ Pause'; btnPause.classList.remove('resumed'); }
            const badge = document.getElementById('badge-' + sessionId);
            if (badge) { badge.textContent = 'ACTIVE'; badge.className = 'badge badge-active'; }
          } else if (effectiveAction === 'abort') {
            const btnAbort = document.getElementById('btn-abort-' + sessionId);
            if (btnAbort) btnAbort.disabled = true;
            if (btnPause) btnPause.disabled = true;
            const badge = document.getElementById('badge-' + sessionId);
            if (badge) { badge.textContent = 'ABORTED'; badge.className = 'badge badge-aborted'; }
          }
          showToast('Session ' + effectiveAction + ' command sent');
        } else {
          showToast('Control error: ' + (data.error || 'Failed'));
        }
      } catch (err) {
        showToast('Control error: ' + err.message);
      }
    }
    window.controlSession = controlSession;

    async function injectSessionPrompt(sessionId) {
      const input = document.getElementById('inject-input-' + sessionId);
      if (!input) return;
      const prompt = input.value.trim();
      if (!prompt) return;

      try {
        const res = await fetch(getControlUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'inject', sessionId, message: prompt })
        });
        const data = await res.json();
        if (data.success) {
          input.value = '';
          showToast('Prompt injected into session');
        } else {
          showToast('Injection error: ' + (data.error || 'Failed'));
        }
      } catch (err) {
        showToast('Injection error: ' + err.message);
      }
    }
    window.injectSessionPrompt = injectSessionPrompt;
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
  const isPrompt = evt.type === "user_prompt" || evt.type === "injected_prompt";
  const isControl = evt.type === "session_pause" || evt.type === "session_resume" || evt.type === "session_abort";
  const category = isTool ? "tool" : (isFile ? "file" : (isPrompt ? "prompt" : "session"));
  const time = evt.timestamp.split("T")[1]?.slice(0, 8) || evt.timestamp;

  let title = "";
  if (isTool) {
    const toolName = evt.data?.toolName || evt.data?.tool || evt.data?.name || "Tool";
    title = `Tool Call: ${escapeHtml(toolName)}`;
  } else if (isFile) {
    title = `File Change: ${escapeHtml(evt.data?.path || "File")}`;
  } else if (evt.type === "injected_prompt") {
    const promptPreview = String(evt.data?.prompt || "").slice(0, 70);
    title = `⚡ Injected Prompt: "${escapeHtml(promptPreview)}..."`;
  } else if (isPrompt) {
    const promptPreview = String(evt.data?.prompt || "").slice(0, 70);
    title = `User Prompt: "${escapeHtml(promptPreview)}..."`;
  } else if (evt.type === "session_pause") {
    title = `⏸ Session Paused (Viewer Control)`;
  } else if (evt.type === "session_resume") {
    title = `▶ Session Resumed (Viewer Control)`;
  } else if (evt.type === "session_abort") {
    title = `⏹ Session Aborted (Viewer Control)`;
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
      ${evt.data?.status ? `<span class="badge ${evt.data.status === 'success' ? 'badge-success' : (evt.data.status === 'paused' ? 'badge-paused' : (evt.data.status === 'aborted' ? 'badge-aborted' : 'badge-error'))}">${escapeHtml(evt.data.status)}</span>` : ''}
    </div>
    <div class="event-body">
      ${evt.type === "injected_prompt" ? `
        <div class="section-label" style="color: #79c0ff;">Injected Steering Message</div>
        <pre class="code-block" style="border-left: 3px solid #388bfd; background: rgba(56, 139, 253, 0.08);">${escapeHtml(evt.data?.prompt)}</pre>
      ` : ''}
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
      ${!evt.data?.input && evt.data?.output === undefined && !parsedDiff && evt.type !== "injected_prompt" ? `
        <div class="section-label">Full Event Data</div>
        <pre class="code-block">${escapeHtml(evt.data)}</pre>
      ` : ''}
    </div>
  </div>`;
}
