import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { getLLM } from "../../lib/llm";


// Two-stage compaction: 1) stub out stale page snapshots (free), then
// 2) summarize the middle of the transcript if it's still over budget.

export const SNAPSHOT_STUB =
  "[old page snapshot removed: superseded by a newer read_page. Call read_page again if you need the current page.]";

const SUMMARIZE_THRESHOLD_CHARS = 60_000; // rough budget, ~4 chars per token
const KEEP_LAST = 8; // recent messages always kept verbatim
const MIN_MIDDLE = 4; // don't bother summarizing a tiny middle


function contentToString(msg: BaseMessage): string {
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

function totalChars(messages: BaseMessage[]): number {
  return messages.reduce((sum, m) => sum + contentToString(m).length, 0);
}


// Replace every read_page result except the newest with a stub. Stubbed
// messages keep their id, so the reducer overwrites the stored originals.
export function evictStaleSnapshots(messages: BaseMessage[]): BaseMessage[] {
  // tool_call_id -> tool name, in case the ToolMessage's name wasn't set
  const callNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg instanceof AIMessage && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        if (call.id) callNames.set(call.id, call.name);
      }
    }
  }

  const snapshotIndexes: number[] = [];
  messages.forEach((msg, i) => {
    if (!(msg instanceof ToolMessage)) return;
    const name = msg.name ?? callNames.get(msg.tool_call_id);
    if (name === "read_page") snapshotIndexes.push(i);
  });

  // the latest snapshot stays: it describes the page the agent is on now
  const stale = new Set(snapshotIndexes.slice(0, -1));
  if (stale.size === 0) return messages;

  return messages.map((msg, i) => {
    if (!stale.has(i)) return msg;
    const toolMsg = msg as ToolMessage;
    if (toolMsg.content === SNAPSHOT_STUB) return msg; // already stubbed
    console.log(`[compaction] evicting stale snapshot (message ${i})`);
    return new ToolMessage({
      id: toolMsg.id,
      tool_call_id: toolMsg.tool_call_id,
      name: toolMsg.name,
      content: SNAPSHOT_STUB,
    });
  });
}


export type SummarizeResult = {
  kept: BaseMessage[]; // messages to actually send to the agent this turn
  removed: BaseMessage[]; // folded into the summary; the node emits RemoveMessage for these
  summary: string; // rolling summary ("" if nothing was ever summarized)
};


// Fold the transcript's middle into a rolling summary when over budget.
// messages[0] (the original task) and the last KEEP_LAST stay verbatim;
// prevSummary is merged in so repeated compactions don't lose facts.
export async function summarizeIfNeeded(
  messages: BaseMessage[],
  prevSummary: string,
): Promise<SummarizeResult> {
  if (totalChars(messages) <= SUMMARIZE_THRESHOLD_CHARS) {
    return { kept: messages, removed: [], summary: prevSummary };
  }

  // the kept tail must not start with a ToolMessage: its parent AI tool call
  // would be summarized away, and the LLM API rejects orphaned tool results
  let cut = Math.max(1, messages.length - KEEP_LAST);
  while (cut > 1 && messages[cut] instanceof ToolMessage) cut--;

  const middle = messages.slice(1, cut);
  if (middle.length < MIN_MIDDLE) {
    return { kept: messages, removed: [], summary: prevSummary };
  }

  console.log(`[compaction] summarizing ${middle.length} messages`);
  const transcript = middle
    .map((m) => `${m.getType()}: ${contentToString(m).slice(0, 2000)}`)
    .join("\n---\n");

  const response = await getLLM().invoke([
    [
      "system",
      "You compress a browser-automation agent's transcript so it can keep working with less context. " +
        "Write a dense progress summary that preserves: what the task is, which pages were visited (URLs), " +
        "login/session state, values already entered into forms, exact facts found (names, codes, numbers), " +
        "errors hit and how they were resolved, and what was in progress. Omit page content that no longer " +
        "matters and step-by-step narration. Plain text, no preamble.",
    ],
    [
      "human",
      (prevSummary ? `Earlier summary (merge it in, do not drop its facts):\n${prevSummary}\n\n` : "") +
        `Transcript to compress:\n${transcript}`,
    ],
  ]);

  const summary =
    typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  return { kept: [messages[0], ...messages.slice(cut)], removed: middle, summary };
}
