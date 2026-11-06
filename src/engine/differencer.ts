import {
  GoldenBaseline,
  RegressionConfig,
  RegressionDiff,
  ToolDelta,
  TraceSession,
} from "../types/index.js";
import { getDistinctToolCalls } from "./assertions/utils.js";
import {
  extractFilesTouched,
  calculateSessionDuration,
} from "../storage/golden.js";

/**
 * Metric summary extracted from a trace session.
 */
export interface SessionMetrics {
  sessionId?: string;
  stepCount: number;
  toolCallBreakdown: Record<string, number>;
  filesTouched: string[];
  durationMs: number;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

/**
 * Parses numeric or percentage threshold strings/numbers.
 * e.g., "20%" -> { isPercent: true, value: 20 }
 *       2      -> { isPercent: false, value: 2 }
 *       "2"    -> { isPercent: false, value: 2 }
 */
export function parseThreshold(
  val: number | string | undefined
): { isPercent: boolean; value: number } | null {
  if (val === undefined || val === null) {
    return null;
  }
  if (typeof val === "number") {
    return { isPercent: false, value: val };
  }
  const str = String(val).trim();
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    return isNaN(num) ? null : { isPercent: true, value: num };
  }
  const num = parseFloat(str);
  return isNaN(num) ? null : { isPercent: false, value: num };
}

/**
 * Parses success threshold strings or numbers into a normalized float between 0.0 and 1.0.
 * e.g., 0.8 -> 0.8
 *       "80%" -> 0.8
 *       "0.8" -> 0.8
 *       80 -> 0.8
 */
export function parseSuccessThreshold(
  val: number | string | undefined,
  defaultVal = 1.0
): number {
  if (val === undefined || val === null) {
    return defaultVal;
  }
  if (typeof val === "number") {
    if (val > 1) return val / 100;
    return Math.max(0, Math.min(1, val));
  }
  const str = String(val).trim();
  if (str.endsWith("%")) {
    const num = parseFloat(str.slice(0, -1));
    return isNaN(num) ? defaultVal : Math.max(0, Math.min(1, num / 100));
  }
  const num = parseFloat(str);
  if (isNaN(num)) return defaultVal;
  if (num > 1) return Math.max(0, Math.min(1, num / 100));
  return Math.max(0, Math.min(1, num));
}

/**
 * Extracts normalized metrics from a TraceSession.
 */
export function extractSessionMetrics(session: TraceSession): SessionMetrics {
  const distinctCalls = getDistinctToolCalls(session.events);
  const toolCallBreakdown: Record<string, number> = {};
  for (const call of distinctCalls) {
    toolCallBreakdown[call.toolName] = (toolCallBreakdown[call.toolName] || 0) + 1;
  }

  const stepCount = distinctCalls.length;
  const filesTouched = extractFilesTouched(session);
  const durationMs = calculateSessionDuration(session);

  let cost: number | undefined;
  if (typeof session.metadata?.cost === "number") {
    cost = session.metadata.cost;
  } else if (typeof session.metadata?.totalCost === "number") {
    cost = session.metadata.totalCost;
  }

  const tokens = session.metadata?.tokens as
    | { input?: number; output?: number; total?: number }
    | undefined;

  return {
    sessionId: session.id,
    stepCount,
    toolCallBreakdown,
    filesTouched,
    durationMs,
    cost,
    tokens,
  };
}

/**
 * Compares an active trace session (or extracted metrics) against a golden baseline,
 * evaluating regression thresholds.
 */
export function compareWithGolden(
  traceSessionOrMetrics: TraceSession | SessionMetrics,
  baseline: GoldenBaseline,
  config?: RegressionConfig
): RegressionDiff {
  const current: SessionMetrics =
    "events" in traceSessionOrMetrics
      ? extractSessionMetrics(traceSessionOrMetrics as TraceSession)
      : (traceSessionOrMetrics as SessionMetrics);

  // 1. Step count deltas
  const stepDelta = current.stepCount - baseline.stepCount;
  let stepPercentDelta = 0;
  if (baseline.stepCount === 0) {
    stepPercentDelta = current.stepCount > 0 ? 100 : 0;
  } else {
    stepPercentDelta =
      Math.round(((current.stepCount - baseline.stepCount) / baseline.stepCount) * 10000) / 100;
  }

  // 2. Tool call breakdown deltas
  const allTools = Array.from(
    new Set([
      ...Object.keys(baseline.toolCallBreakdown),
      ...Object.keys(current.toolCallBreakdown),
    ])
  ).sort();

  const toolDeltas: Record<string, ToolDelta> = {};
  const toolsAdded: string[] = [];
  const toolsRemoved: string[] = [];

  for (const tool of allTools) {
    const bCount = baseline.toolCallBreakdown[tool] || 0;
    const cCount = current.toolCallBreakdown[tool] || 0;
    const delta = cCount - bCount;

    toolDeltas[tool] = {
      baseline: bCount,
      current: cCount,
      delta,
    };

    if (bCount === 0 && cCount > 0) {
      toolsAdded.push(tool);
    }
    if (bCount > 0 && cCount === 0) {
      toolsRemoved.push(tool);
    }
  }

  // 3. Duration deltas
  const durationDelta = current.durationMs - baseline.durationMs;
  let durationPercentDelta: number | undefined;
  if (baseline.durationMs > 0) {
    durationPercentDelta =
      Math.round(((current.durationMs - baseline.durationMs) / baseline.durationMs) * 10000) / 100;
  }

  // 4. Cost deltas
  let costDelta: number | undefined;
  let costPercentDelta: number | undefined;
  if (baseline.cost !== undefined && current.cost !== undefined) {
    costDelta = Math.round((current.cost - baseline.cost) * 10000) / 10000;
    if (baseline.cost > 0) {
      costPercentDelta =
        Math.round(((current.cost - baseline.cost) / baseline.cost) * 10000) / 100;
    }
  }

  // 5. Evaluate regression triggers
  const regressionReasons: string[] = [];

  // A. Step Count Increase
  const stepThreshold = parseThreshold(config?.max_step_increase ?? "20%");
  if (stepThreshold) {
    if (stepThreshold.isPercent) {
      if (stepDelta > 0 && stepPercentDelta > stepThreshold.value) {
        regressionReasons.push(
          `Step count increased by ${stepPercentDelta.toFixed(1)}% (+${stepDelta} steps: ${baseline.stepCount} -> ${current.stepCount}), exceeding threshold of ${config?.max_step_increase ?? "20%"}`
        );
      }
    } else {
      if (stepDelta > stepThreshold.value) {
        regressionReasons.push(
          `Step count increased by ${stepDelta} steps (${baseline.stepCount} -> ${current.stepCount}), exceeding max allowed increase of ${stepThreshold.value} step(s)`
        );
      }
    }
  }

  // B. Allowed Tools Enforcement
  if (config?.allowed_tools && config.allowed_tools.length > 0) {
    const allowed = new Set(config.allowed_tools.map((t) => t.toLowerCase()));
    for (const [tool, count] of Object.entries(current.toolCallBreakdown)) {
      if (count > 0 && !allowed.has(tool.toLowerCase())) {
        regressionReasons.push(
          `Tool '${tool}' is not in allowed_tools list [${config.allowed_tools.join(", ")}] (invoked ${count} time(s))`
        );
      }
    }
  }

  // C. Disallowed Tools Enforcement
  if (config?.disallowed_tools && config.disallowed_tools.length > 0) {
    const disallowed = new Set(config.disallowed_tools.map((t) => t.toLowerCase()));
    for (const [tool, count] of Object.entries(current.toolCallBreakdown)) {
      if (count > 0 && disallowed.has(tool.toLowerCase())) {
        regressionReasons.push(
          `Disallowed tool '${tool}' was invoked (${count} time(s))`
        );
      }
    }
  }

  // D. Duration Increase Enforcement
  if (config?.max_duration_increase !== undefined) {
    const durThreshold = parseThreshold(config.max_duration_increase);
    if (durThreshold) {
      if (durThreshold.isPercent) {
        if (
          durationPercentDelta !== undefined &&
          durationDelta > 0 &&
          durationPercentDelta > durThreshold.value
        ) {
          regressionReasons.push(
            `Duration increased by ${durationPercentDelta.toFixed(1)}% (+${durationDelta}ms: ${baseline.durationMs}ms -> ${current.durationMs}ms), exceeding threshold of ${config.max_duration_increase}`
          );
        }
      } else {
        if (durationDelta > durThreshold.value) {
          regressionReasons.push(
            `Duration increased by ${durationDelta}ms (${baseline.durationMs}ms -> ${current.durationMs}ms), exceeding max allowed increase of ${durThreshold.value}ms`
          );
        }
      }
    }
  }

  // E. Cost Increase Enforcement
  if (config?.max_cost_increase !== undefined && costDelta !== undefined) {
    const costThreshold = parseThreshold(config.max_cost_increase);
    if (costThreshold) {
      if (costThreshold.isPercent) {
        if (
          costPercentDelta !== undefined &&
          costDelta > 0 &&
          costPercentDelta > costThreshold.value
        ) {
          regressionReasons.push(
            `Cost increased by ${costPercentDelta.toFixed(1)}% (+${costDelta}: $${baseline.cost} -> $${current.cost}), exceeding threshold of ${config.max_cost_increase}`
          );
        }
      } else {
        if (costDelta > costThreshold.value) {
          regressionReasons.push(
            `Cost increased by $${costDelta.toFixed(4)} ($${baseline.cost} -> $${current.cost}), exceeding max allowed increase of $${costThreshold.value}`
          );
        }
      }
    }
  }

  return {
    stepDelta,
    stepPercentDelta,
    toolDeltas,
    toolsAdded,
    toolsRemoved,
    durationDelta,
    durationPercentDelta,
    costDelta,
    costPercentDelta,
    isRegression: regressionReasons.length > 0,
    regressionReasons,
    baseline: {
      sessionId: baseline.traceSessionId,
      stepCount: baseline.stepCount,
      durationMs: baseline.durationMs,
      toolCallBreakdown: baseline.toolCallBreakdown,
    },
    current: {
      sessionId: current.sessionId,
      stepCount: current.stepCount,
      durationMs: current.durationMs,
      toolCallBreakdown: current.toolCallBreakdown,
    },
  };
}

/**
 * Structured diff between two trace sessions.
 */
export interface TraceDiffResult {
  sessionA: { id: string; stepCount: number; durationMs: number; cost?: number; tokens?: number };
  sessionB: { id: string; stepCount: number; durationMs: number; cost?: number; tokens?: number };
  stepDelta: number;
  stepPercentDelta: number;
  durationDelta: number;
  durationPercentDelta?: number;
  costDelta?: number;
  costPercentDelta?: number;
  toolDeltas: Record<string, ToolDelta>;
  toolsAdded: string[];
  toolsRemoved: string[];
  filesTouchedA: string[];
  filesTouchedB: string[];
  filesAdded: string[];
  filesRemoved: string[];
  filesShared: string[];
}

/**
 * Directly compares two trace sessions across steps, tools, duration, cost, and files touched.
 */
export function compareTraces(sessionA: TraceSession, sessionB: TraceSession): TraceDiffResult {
  const metricsA = extractSessionMetrics(sessionA);
  const metricsB = extractSessionMetrics(sessionB);

  const stepDelta = metricsB.stepCount - metricsA.stepCount;
  let stepPercentDelta = 0;
  if (metricsA.stepCount === 0) {
    stepPercentDelta = metricsB.stepCount > 0 ? 100 : 0;
  } else {
    stepPercentDelta =
      Math.round(((metricsB.stepCount - metricsA.stepCount) / metricsA.stepCount) * 10000) / 100;
  }

  const durationDelta = metricsB.durationMs - metricsA.durationMs;
  let durationPercentDelta: number | undefined;
  if (metricsA.durationMs > 0) {
    durationPercentDelta =
      Math.round(((metricsB.durationMs - metricsA.durationMs) / metricsA.durationMs) * 10000) / 100;
  }

  let costDelta: number | undefined;
  let costPercentDelta: number | undefined;
  if (metricsA.cost !== undefined && metricsB.cost !== undefined) {
    costDelta = Math.round((metricsB.cost - metricsA.cost) * 10000) / 10000;
    if (metricsA.cost > 0) {
      costPercentDelta =
        Math.round(((metricsB.cost - metricsA.cost) / metricsA.cost) * 10000) / 100;
    }
  }

  const allTools = Array.from(
    new Set([
      ...Object.keys(metricsA.toolCallBreakdown),
      ...Object.keys(metricsB.toolCallBreakdown),
    ])
  ).sort();

  const toolDeltas: Record<string, ToolDelta> = {};
  const toolsAdded: string[] = [];
  const toolsRemoved: string[] = [];

  for (const tool of allTools) {
    const aCount = metricsA.toolCallBreakdown[tool] || 0;
    const bCount = metricsB.toolCallBreakdown[tool] || 0;
    const delta = bCount - aCount;
    toolDeltas[tool] = { baseline: aCount, current: bCount, delta };
    if (aCount === 0 && bCount > 0) toolsAdded.push(tool);
    if (aCount > 0 && bCount === 0) toolsRemoved.push(tool);
  }

  const setA = new Set(metricsA.filesTouched);
  const setB = new Set(metricsB.filesTouched);
  const filesAdded = metricsB.filesTouched.filter((f) => !setA.has(f));
  const filesRemoved = metricsA.filesTouched.filter((f) => !setB.has(f));
  const filesShared = metricsB.filesTouched.filter((f) => setA.has(f));

  return {
    sessionA: {
      id: sessionA.id,
      stepCount: metricsA.stepCount,
      durationMs: metricsA.durationMs,
      cost: metricsA.cost,
      tokens: metricsA.tokens?.total,
    },
    sessionB: {
      id: sessionB.id,
      stepCount: metricsB.stepCount,
      durationMs: metricsB.durationMs,
      cost: metricsB.cost,
      tokens: metricsB.tokens?.total,
    },
    stepDelta,
    stepPercentDelta,
    durationDelta,
    durationPercentDelta,
    costDelta,
    costPercentDelta,
    toolDeltas,
    toolsAdded,
    toolsRemoved,
    filesTouchedA: metricsA.filesTouched,
    filesTouchedB: metricsB.filesTouched,
    filesAdded,
    filesRemoved,
    filesShared,
  };
}
