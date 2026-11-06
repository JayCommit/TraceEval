/**
 * TraceEval Shared CSS Stylesheet for HTML Trace Viewer and Multi-Agent Arena.
 * Zero-dependency, offline-first, dark theme matching GitHub / terminal aesthetics.
 */
export const VIEWER_CSS = `
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
      box-shadow: 0 0 8px var(--success);
    }

    .grid-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
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
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .event-card:hover {
      border-color: #58a6ff55;
    }

    .event-card.new-flash {
      animation: flash-border 2s ease-out;
    }

    @keyframes flash-border {
      0% { border-color: var(--success); box-shadow: 0 0 12px rgba(63, 185, 80, 0.4); }
      100% { border-color: var(--card-border); box-shadow: none; }
    }

    .event-header {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.01);
    }

    .event-header:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .event-index {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      width: 32px;
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
    .type-file { background: rgba(188, 140, 255, 0.15); color: var(--purple); }
    .type-prompt { background: rgba(210, 153, 34, 0.15); color: var(--warning); }
    .type-session { background: rgba(139, 148, 158, 0.15); color: var(--text-muted); }

    .event-title {
      font-weight: 600;
      color: #f0f6fc;
      font-size: 13px;
      flex-grow: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .event-duration {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .event-body {
      padding: 16px;
      border-top: 1px solid var(--card-border);
      background: #0d111755;
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
      white-space: pre-wrap;
      word-break: break-all;
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

    .diff-header-right {
      display: flex;
      align-items: center;
      gap: 12px;
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

    .diff-view-toggle {
      display: inline-flex;
      background: #1c2128;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }

    .diff-toggle-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-family: var(--font-sans);
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .diff-toggle-btn:hover {
      color: var(--text);
    }

    .diff-toggle-btn.active {
      background: var(--accent);
      color: #0d1117;
      font-weight: 700;
    }

    /* Mode switching */
    .file-diff-box.view-split .diff-split-container { display: block; }
    .file-diff-box.view-split .diff-unified-container { display: none; }
    .file-diff-box.view-unified .diff-split-container { display: none; }
    .file-diff-box.view-unified .diff-unified-container { display: block; }

    /* Side-by-Side Split Diff */
    .diff-split-container {
      overflow-x: auto;
      max-height: 480px;
      overflow-y: auto;
      background: var(--code-bg);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
    }

    .split-table {
      display: flex;
      flex-direction: column;
      min-width: 600px;
    }

    .split-row {
      display: flex;
      width: 100%;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }

    .split-row:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    .split-cell {
      width: 50%;
      display: flex;
      align-items: stretch;
      overflow-x: auto;
      white-space: pre;
    }

    .split-left {
      border-right: 1px solid var(--card-border);
    }

    .split-num {
      width: 38px;
      flex-shrink: 0;
      text-align: right;
      padding-right: 8px;
      color: var(--text-muted);
      user-select: none;
      background: rgba(0, 0, 0, 0.2);
    }

    .split-gutter-symbol {
      width: 16px;
      flex-shrink: 0;
      text-align: center;
      user-select: none;
      font-weight: 700;
    }

    .split-code {
      flex-grow: 1;
      padding-left: 4px;
      padding-right: 8px;
    }

    .split-del {
      background: rgba(248, 81, 73, 0.12);
      color: #ffa198;
    }

    .split-del .split-gutter-symbol {
      color: var(--danger);
    }

    .split-del .split-num {
      color: rgba(248, 81, 73, 0.7);
    }

    .split-add {
      background: rgba(63, 185, 80, 0.12);
      color: #7ee787;
    }

    .split-add .split-gutter-symbol {
      color: var(--success);
    }

    .split-add .split-num {
      color: rgba(63, 185, 80, 0.7);
    }

    .split-empty {
      background: rgba(0, 0, 0, 0.15);
    }

    .split-hunk, .split-truncated {
      background: rgba(188, 140, 255, 0.08);
      color: var(--purple);
      padding: 3px 12px;
      font-size: 11px;
    }

    .split-truncated {
      background: rgba(210, 153, 34, 0.08);
      color: var(--warning);
    }

    .split-cell-full {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diff-code-container {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
      overflow-x: auto;
      max-height: 480px;
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

    /* Intra-Line / Token-Level Diff Highlights */
    .diff-word-del {
      background: rgba(248, 81, 73, 0.4);
      color: #ffc1ba;
      border-radius: 3px;
      padding: 0 2px;
      font-weight: 600;
    }

    .diff-word-add {
      background: rgba(63, 185, 80, 0.4);
      color: #aff5b4;
      border-radius: 3px;
      padding: 0 2px;
      font-weight: 600;
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
      color: #e6edf3;
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

    /* Agent Tags & Badges */
    .agent-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-family: var(--font-mono);
    }

    .agent-claude, .agent-claude-code {
      background: rgba(188, 140, 255, 0.2);
      color: #d2a8ff;
      border: 1px solid #bc8cff;
    }

    .agent-cursor {
      background: rgba(88, 166, 255, 0.2);
      color: #79c0ff;
      border: 1px solid #58a6ff;
    }

    .agent-openai, .agent-chatgpt {
      background: rgba(63, 185, 80, 0.2);
      color: #7ee787;
      border: 1px solid #3fb950;
    }

    .agent-grok, .agent-grok-bot {
      background: rgba(248, 81, 73, 0.2);
      color: #ffa198;
      border: 1px solid #f85149;
    }

    .agent-antigravity, .agent-agy {
      background: rgba(210, 153, 34, 0.2);
      color: #e3b341;
      border: 1px solid #d29922;
    }

    .agent-opencode {
      background: rgba(56, 139, 253, 0.2);
      color: #a5d6ff;
      border: 1px solid #388bfd;
    }

    /* Multi-Agent Arena Controls & Layout */
    .arena-select {
      background: #1c2128;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: var(--font-sans);
      cursor: pointer;
    }

    .arena-select:focus {
      outline: none;
      border-color: var(--accent);
    }

    .arena-launch-control {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .arena-scoreboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .scoreboard-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .scoreboard-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .scoreboard-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      text-align: center;
    }

    .scoreboard-metric-label {
      font-size: 10px;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 600;
    }

    .scoreboard-metric-val {
      font-size: 16px;
      font-weight: 700;
      color: #f0f6fc;
      font-family: var(--font-mono);
      margin-top: 2px;
    }

    .scoreboard-diff-card {
      background: rgba(88, 166, 255, 0.05);
      border: 1px solid rgba(88, 166, 255, 0.35);
    }

    .diff-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 4px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .diff-item:last-child {
      border-bottom: none;
    }

    .arena-columns {
      display: grid;
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .arena-columns {
        grid-template-columns: 1fr !important;
      }
    }

    .arena-pane {
      background: #12161f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      overflow: hidden;
    }

    .arena-pane-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--card-border);
    }

    .arena-pane-agent {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .arena-pane-id {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }

    .arena-pane-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .arena-pane-subbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .pane-search {
      margin-left: auto;
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 4px;
      color: var(--text);
      padding: 4px 8px;
      font-size: 12px;
      width: 180px;
    }

    .pane-search:focus {
      outline: none;
      border-color: var(--accent);
    }

    .arena-unpin-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }

    .arena-unpin-btn:hover {
      background: rgba(248, 81, 73, 0.2);
      color: var(--danger);
    }
`;
