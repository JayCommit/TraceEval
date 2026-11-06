import { describe, it, expect } from "vitest";
import { generateTraceHtml } from "../src/viewer/html.js";
import { TraceSession, GoldenBaseline, RegressionDiff } from "../src/types/index.js";

describe("HTML Trace Viewer", () => {
  const mockSession: TraceSession = {
    id: "session-view-test",
    agent: "claude-code",
    startTime: "2026-11-06T00:00:00.000Z",
    endTime: "2026-11-06T00:00:05.000Z",
    durationMs: 5000,
    status: "completed",
    command: "claude -p 'Refactor auth'",
    events: [
      {
        id: "evt-1",
        sessionId: "session-view-test",
        timestamp: "2026-11-06T00:00:01.000Z",
        type: "user_prompt",
        agent: "claude-code",
        data: { prompt: "Refactor auth" },
      },
      {
        id: "evt-2",
        sessionId: "session-view-test",
        timestamp: "2026-11-06T00:00:02.000Z",
        type: "tool_call",
        agent: "claude-code",
        data: {
          toolName: "Edit",
          input: { path: "src/auth.ts" },
          output: "File saved",
          status: "success",
          durationMs: 120,
        },
      },
      {
        id: "evt-3",
        sessionId: "session-view-test",
        timestamp: "2026-11-06T00:00:03.000Z",
        type: "file_change",
        agent: "claude-code",
        data: { path: "src/auth.ts", changeType: "modify" },
      },
    ],
    metadata: {
      cost: 0.015,
      tokens: 4200,
    },
  };

  it("should generate self-contained, offline HTML without external CDNs", () => {
    const html = generateTraceHtml(mockSession);

    // Verify DOCTYPE and structure
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("TraceEval — session-view-test");
    expect(html).toContain("claude-code");
    expect(html).toContain("5000ms");
    expect(html).toContain("Edit");
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("$0.0150");
    expect(html).toContain("4,200");

    // Ensure completely offline (no http/https script or link tags to CDNs)
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
  });

  it("should include golden baseline comparison when provided", () => {
    const golden: GoldenBaseline = {
      testName: "Auth Refactor Test",
      createdAt: "2026-11-05T00:00:00.000Z",
      traceSessionId: "session-golden-1",
      stepCount: 1,
      durationMs: 4000,
      toolCallBreakdown: { Edit: 1 },
      filesTouched: ["src/auth.ts"],
    };

    const diff: RegressionDiff = {
      stepDelta: 0,
      stepPercentDelta: 0,
      toolDeltas: {},
      toolsAdded: [],
      toolsRemoved: [],
      durationDelta: 1000,
      durationPercentDelta: 25,
      isRegression: false,
      regressionReasons: [],
    };

    const html = generateTraceHtml(mockSession, { golden, diff });
    expect(html).toContain("Golden Baseline: Auth Refactor Test");
    expect(html).toContain("Baseline Steps:");
    expect(html).toContain("Current Steps:");
  });

  it("should highlight regression warning in golden box if regression exists", () => {
    const golden: GoldenBaseline = {
      testName: "Auth Test",
      createdAt: "2026-11-05T00:00:00.000Z",
      traceSessionId: "g1",
      stepCount: 1,
      durationMs: 2000,
      toolCallBreakdown: { Edit: 1 },
      filesTouched: [],
    };

    const diff: RegressionDiff = {
      stepDelta: 2,
      stepPercentDelta: 200,
      toolDeltas: {},
      toolsAdded: ["Bash"],
      toolsRemoved: [],
      durationDelta: 3000,
      durationPercentDelta: 150,
      isRegression: true,
      regressionReasons: ["Step count increased by 2 steps"],
    };

    const html = generateTraceHtml(mockSession, { golden, diff });
    expect(html).toContain("Regression Warning:");
    expect(html).toContain("Step count increased by 2 steps");
  });

  it("should rigorously escape malicious XSS payloads in prompts and tool inputs", () => {
    const maliciousSession: TraceSession = {
      id: "session-<script>alert('id-xss')</script>",
      agent: "claude-code<img src=x onerror=alert(1)>",
      startTime: "2026-11-06T00:00:00.000Z",
      status: "completed",
      events: [
        {
          id: "evt-xss",
          sessionId: "session-xss",
          timestamp: "2026-11-06T00:00:01.000Z",
          type: "user_prompt",
          agent: "claude-code",
          data: {
            prompt: '<script>alert("pwned")</script>',
          },
        },
        {
          id: "evt-tool-xss",
          sessionId: "session-xss",
          timestamp: "2026-11-06T00:00:02.000Z",
          type: "tool_call",
          agent: "claude-code",
          data: {
            toolName: 'Edit"><script>evil()</script>',
            input: { code: '"><img src=x onerror=alert(2)>' },
            output: '"><svg onload=alert(3)>',
          },
        },
      ],
    };

    const html = generateTraceHtml(maliciousSession);

    // Verify raw unescaped script tags are NOT present in the HTML output
    expect(html).not.toContain("<script>alert(");
    expect(html).not.toContain("<script>evil()");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload=");

    // Verify they are safely HTML entity encoded
    expect(html).toContain("&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
