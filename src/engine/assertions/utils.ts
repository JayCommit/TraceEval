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
 * that correspond to the same tool invocation, while accurately preserving uncompleted calls.
 */
export function getDistinctToolCalls(events: TraceEvent[]): DistinctToolCall[] {
  const toolEvents = events.filter(
    (e) => e.type === "tool_call" || e.type === "tool_call_start"
  );

  const seenToolUseIds = new Set<string>();
  const calls: DistinctToolCall[] = [];

  // Track completed counts per toolName for events lacking explicit toolUseId
  const completedCountsWithoutId = new Map<string, number>();

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
      } else {
        completedCountsWithoutId.set(
          toolName,
          (completedCountsWithoutId.get(toolName) || 0) + 1
        );
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

  // Pass 2: Include tool_call_start only if not already paired/accounted for by tool_call
  const consumedStartsWithoutId = new Map<string, number>();

  for (const e of toolEvents) {
    if (e.type === "tool_call_start") {
      const toolUseId = (e.data?.toolUseId as string) || (e.data?.id as string);
      const toolName =
        (e.data?.toolName as string) ||
        (e.data?.tool as string) ||
        (e.data?.name as string) ||
        "unknown";

      if (toolUseId) {
        if (!seenToolUseIds.has(toolUseId)) {
          seenToolUseIds.add(toolUseId);
          calls.push({
            toolName,
            toolUseId,
            status: "started",
            data: e.data || {},
          });
        }
      } else {
        const completedCount = completedCountsWithoutId.get(toolName) || 0;
        const consumedCount = consumedStartsWithoutId.get(toolName) || 0;

        if (consumedCount < completedCount) {
          // This start corresponds to one of the completed calls in Pass 1
          consumedStartsWithoutId.set(toolName, consumedCount + 1);
        } else {
          // Extra start event without matching tool_call (e.g. aborted/interrupted execution)
          consumedStartsWithoutId.set(toolName, consumedCount + 1);
          calls.push({
            toolName,
            status: "started",
            data: e.data || {},
          });
        }
      }
    }
  }

  return calls;
}
