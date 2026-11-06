import { TraceEvent } from "../../types/index.js";

export interface DistinctToolCall {
  toolName: string;
  toolUseId?: string;
  durationMs?: number;
  status?: string;
  data: Record<string, unknown>;
}

/**
 * Extracts distinct tool calls from a trace event sequence.
 * Deduplicates paired PreToolUse (tool_call_start) and PostToolUse (tool_call) events
 * that correspond to the same tool invocation.
 */
export function getDistinctToolCalls(events: TraceEvent[]): DistinctToolCall[] {
  const toolEvents = events.filter(
    (e) => e.type === "tool_call" || e.type === "tool_call_start"
  );

  const seenToolUseIds = new Set<string>();
  const calls: DistinctToolCall[] = [];

  // Pass 1: Prioritize completed tool calls (type === "tool_call")
  for (const e of toolEvents) {
    if (e.type === "tool_call") {
      const toolName =
        (e.data?.toolName as string) ||
        (e.data?.tool as string) ||
        (e.data?.name as string) ||
        "unknown";
      const toolUseId = (e.data?.toolUseId as string) || (e.data?.id as string);

      if (toolUseId) {
        seenToolUseIds.add(toolUseId);
      }
      calls.push({
        toolName,
        toolUseId,
        durationMs: typeof e.data?.durationMs === "number" ? e.data.durationMs : undefined,
        status: (e.data?.status as string) || "success",
        data: e.data || {},
      });
    }
  }

  // Pass 2: Include tool_call_start only if not already recorded by tool_call
  for (const e of toolEvents) {
    if (e.type === "tool_call_start") {
      const toolUseId = (e.data?.toolUseId as string) || (e.data?.id as string);
      if (toolUseId) {
        if (!seenToolUseIds.has(toolUseId)) {
          seenToolUseIds.add(toolUseId);
          const toolName =
            (e.data?.toolName as string) ||
            (e.data?.tool as string) ||
            (e.data?.name as string) ||
            "unknown";
          calls.push({
            toolName,
            toolUseId,
            status: "started",
            data: e.data || {},
          });
        }
      } else if (calls.length === 0) {
        // If there were no tool_call events in the trace, include tool_call_start
        const toolName =
          (e.data?.toolName as string) ||
          (e.data?.tool as string) ||
          (e.data?.name as string) ||
          "unknown";
        calls.push({
          toolName,
          status: "started",
          data: e.data || {},
        });
      }
    }
  }

  return calls;
}
