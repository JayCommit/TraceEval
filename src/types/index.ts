import { z } from "zod";

/**
 * Event types captured in an agent trace.
 */
export const TraceEventTypeSchema = z.enum([
  "session_start",
  "session_end",
  "user_prompt",
  "tool_call_start",
  "tool_call",
  "file_change",
  "agent_thought",
  "custom",
]);

export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;

/**
 * Data payload for tool calls.
 */
export const ToolCallDataSchema = z.object({
  toolName: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  durationMs: z.number().optional(),
  status: z.enum(["success", "error"]).optional(),
  error: z.string().optional(),
});

export type ToolCallData = z.infer<typeof ToolCallDataSchema>;

/**
 * Standardized single event in a trace stream.
 */
export const TraceEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.string(),
  type: TraceEventTypeSchema,
  agent: z.string().default("claude-code"),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/**
 * Metadata and collection of events representing an entire agent session.
 */
export const TraceSessionSchema = z.object({
  id: z.string(),
  agent: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  durationMs: z.number().optional(),
  command: z.string().optional(),
  prompt: z.string().optional(),
  status: z.enum(["active", "completed", "error"]).default("active"),
  events: z.array(TraceEventSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TraceSession = z.infer<typeof TraceSessionSchema>;

/**
 * Supported assertion configurations.
 */
export const FileContainsAssertionSchema = z.object({
  type: z.literal("file_contains"),
  path: z.string(),
  pattern: z.string().optional(),
  not_contains: z.string().optional(),
  message: z.string().optional(),
});

export const FileExistsAssertionSchema = z.object({
  type: z.literal("file_exists"),
  path: z.string(),
  should_exist: z.boolean().default(true),
  message: z.string().optional(),
});

export const TestsPassAssertionSchema = z.object({
  type: z.literal("tests_pass"),
  command: z.string(),
  timeout_ms: z.number().optional().default(60000),
  message: z.string().optional(),
});

export const MaxStepsAssertionSchema = z.object({
  type: z.literal("max_steps"),
  max: z.number(),
  message: z.string().optional(),
});

export const ToolCalledAssertionSchema = z.object({
  type: z.literal("tool_called"),
  tool: z.string(),
  min: z.number().optional().default(1),
  max: z.number().optional(),
  message: z.string().optional(),
});

export const NoDangerousCommandsAssertionSchema = z.object({
  type: z.literal("no_dangerous_commands"),
  forbidden_patterns: z.array(z.string()).optional(),
  allowed_commands: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export const CostUnderAssertionSchema = z.object({
  type: z.literal("cost_under"),
  max_cost_usd: z.number().optional(),
  max_tokens: z.number().optional(),
  message: z.string().optional(),
});

export const LLMJudgeAssertionSchema = z.object({
  type: z.literal("llm_judge"),
  prompt: z.string().optional(),
  judge: z.string().optional(),
  criteria: z.string().optional(),
  provider: z.enum(["ollama", "openai", "mock"]).optional(),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  threshold: z.number().optional().default(0.7),
  enabled: z.boolean().optional(),
  message: z.string().optional(),
});

export const AssertionSchema = z.discriminatedUnion("type", [
  FileContainsAssertionSchema,
  FileExistsAssertionSchema,
  TestsPassAssertionSchema,
  MaxStepsAssertionSchema,
  ToolCalledAssertionSchema,
  NoDangerousCommandsAssertionSchema,
  CostUnderAssertionSchema,
  LLMJudgeAssertionSchema,
]);

export type AssertionConfig = z.infer<typeof AssertionSchema>;

/**
 * Regression configuration specifying thresholds against a golden run.
 */
export const RegressionConfigSchema = z.object({
  max_step_increase: z.union([z.number(), z.string()]).optional(),
  allowed_tools: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  max_cost_increase: z.union([z.number(), z.string()]).optional(),
  max_duration_increase: z.union([z.number(), z.string()]).optional(),
});

export type RegressionConfig = z.infer<typeof RegressionConfigSchema>;

/**
 * Known-good (golden) baseline snapshot of an agent run.
 */
export const GoldenBaselineSchema = z.object({
  testName: z.string(),
  createdAt: z.string(),
  traceSessionId: z.string(),
  stepCount: z.number(),
  toolCallBreakdown: z.record(z.string(), z.number()),
  filesTouched: z.array(z.string()).default([]),
  durationMs: z.number(),
  cost: z.number().optional(),
  tokens: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      total: z.number().optional(),
    })
    .optional(),
  snapshotMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type GoldenBaseline = z.infer<typeof GoldenBaselineSchema>;

/**
 * Delta for individual tool calls in regression diff.
 */
export interface ToolDelta {
  baseline: number;
  current: number;
  delta: number;
}

/**
 * Structured diff between a current trace session and its golden baseline.
 */
export interface RegressionDiff {
  stepDelta: number;
  stepPercentDelta: number;
  toolDeltas: Record<string, ToolDelta>;
  toolsAdded: string[];
  toolsRemoved: string[];
  durationDelta: number;
  durationPercentDelta?: number;
  costDelta?: number;
  costPercentDelta?: number;
  isRegression: boolean;
  regressionReasons: string[];
  baseline?: {
    sessionId: string;
    stepCount: number;
    durationMs: number;
    toolCallBreakdown: Record<string, number>;
  };
  current?: {
    sessionId?: string;
    stepCount: number;
    durationMs: number;
    toolCallBreakdown: Record<string, number>;
  };
}

/**
 * Declarative test case schema defined in YAML or Markdown.
 */
export const TestCaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  spec: z.string().optional(), // Reference to AGENTS.md section or requirement
  setup: z
    .object({
      command: z.string().optional(),
      files: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  run: z
    .object({
      command: z.string().optional(),
      prompt: z.string().optional(),
      agent: z.string().optional(),
      timeout_ms: z.number().optional(),
    })
    .optional(),
  assertions: z.array(AssertionSchema),
  regression: RegressionConfigSchema.optional(),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

/**
 * Results of single assertion evaluation.
 */
export interface AssertionResult {
  assertion: AssertionConfig;
  passed: boolean;
  message: string;
  actual?: unknown;
  expected?: unknown;
  durationMs?: number;
}

/**
 * Individual run result in a statistical multi-run execution.
 */
export interface MultiRunIndividualResult {
  runIndex: number;
  status: "passed" | "failed" | "skipped";
  traceSessionId?: string;
  durationMs: number;
  stepCount?: number;
  cost?: number;
  tokens?: number;
  error?: string;
}

/**
 * Aggregated statistical multi-run results.
 */
export interface MultiRunResult {
  runs: number;
  passed: number;
  failed: number;
  successRate: number; // 0.0 to 1.0 (e.g. 0.8)
  minSuccessThreshold: number; // 0.0 to 1.0
  passThresholdMet: boolean;
  averageSteps?: number;
  averageDurationMs: number;
  averageCost?: number;
  averageTokens?: number;
  individualRuns: MultiRunIndividualResult[];
}

/**
 * Suite-level efficiency and cost metrics.
 */
export interface SuiteEfficiencyMetrics {
  averageStepsPerTask?: number;
  averageCostPerTask?: number;
  averageTokensPerTask?: number;
  averageDurationPerTask?: number;
  totalCost?: number;
  totalTokens?: number;
  successfulTaskCost?: number;
  successfulTaskSteps?: number;
}

/**
 * Results of running a test case.
 */
export interface TestResult {
  testName: string;
  filePath?: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  assertionResults: AssertionResult[];
  traceSessionId?: string;
  error?: string;
  goldenBaseline?: GoldenBaseline;
  regressionDiff?: RegressionDiff;
  multiRun?: MultiRunResult;
  stepCount?: number;
  cost?: number;
  tokens?: number;
}

/**
 * Aggregate results across an entire test suite execution.
 */
export interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
  multiRun?: {
    runs: number;
    minSuccessThreshold: number;
    overallSuccessRate: number;
  };
  efficiency?: SuiteEfficiencyMetrics;
}
