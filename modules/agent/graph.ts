import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  messagesStateReducer,
} from "@langchain/langgraph";
import { BaseMessage, HumanMessage, RemoveMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getLLM } from "../../lib/llm";
import { AGENT_PROMPT } from "./prompts";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tools } from "./tools";
import { evictStaleSnapshots, summarizeIfNeeded } from "./compaction";


export type Plan = {
  id: number;
  description: string;
  status: "pending" | "completed";
};


// max times the router sends unfinished plans back to the agent
const MAX_NUDGES = 2;


export const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  plans: Annotation<Plan[]>({
    reducer: (_prev, next) => next, // plan tools return the whole list, last write wins
    default: () => [],
  }),
  nudges: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  // rolling summary of compacted-away messages; injected into the system prompt
  summary: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});


async function agentNode(state: typeof State.State) {
  // plan tools are closures over this copy: tools never receive graph state,
  // so they must be defined per run, inside the node
  const plans: Plan[] = state.plans.map((p) => ({ ...p }));


  const readPlan = tool(
    async () => {
      console.log("[tool] read_plan called");
      if (plans.length === 0)
        return "No plans exist yet. If the task needs more than one step, call create_plan first.";
      return JSON.stringify(plans, null, 2);
    },
    {
      name: "read_plan",
      description: "Read the current plan list with each step's id and status (pending/completed).",
      schema: z.object({}),
    },
  );


  const createPlan = tool(
    async ({ steps }) => {
      console.log(`[tool] create_plan called with ${steps.length} steps`);
      if (steps.length === 0) return "steps is empty; pass at least one step description.";
      let nextId = plans.length ? Math.max(...plans.map((p) => p.id)) + 1 : 1;
      for (const description of steps) {
        plans.push({ id: nextId++, description, status: "pending" });
      }
      return `Created ${steps.length} plan step(s):\n` + JSON.stringify(plans, null, 2);
    },
    {
      name: "create_plan",
      description:
        "Create plan steps for the current task. Each step gets an id and starts as pending. Call once, before acting, with all the steps you foresee.",
      schema: z.object({
        steps: z
          .array(z.string())
          .describe('Ordered step descriptions, e.g. ["visit linkedin.com and log in if needed", "open the profile page"]'),
      }),
    },
  );


  const writePlan = tool(
    async ({ id, status }) => {
      console.log(`[tool] write_plan called: ${id} -> ${status}`);
      const plan = plans.find((p) => p.id === id);
      if (!plan) return `No plan found with id ${id}. Call read_plan to see valid ids.`;
      plan.status = status;
      return `Plan ${id} marked ${status}.`;
    },
    {
      name: "write_plan",
      description:
        "Update one plan step's status by id. Mark a step completed as soon as you finish it, before starting the next one.",
      schema: z.object({
        id: z.number().describe("The plan step's id, as shown by read_plan"),
        status: z.enum(["pending", "completed"]).describe("The new status"),
      }),
    },
  );


  // compaction before the agent sees the transcript: stub stale snapshots,
  // then fold the middle into the rolling summary if still over budget
  let messages = evictStaleSnapshots(state.messages);
  const compacted = await summarizeIfNeeded(messages, state.summary);
  messages = compacted.kept;

  // the summary lives in the prompt, not the message list, so later rounds can't eat it
  const prompt = compacted.summary
    ? `${AGENT_PROMPT}\n\n## Progress so far (earlier steps, compacted)\n${compacted.summary}`
    : AGENT_PROMPT;

  const agent = createReactAgent({
    llm: getLLM(),
    tools: [...tools, readPlan, createPlan, writePlan],
    prompt,
  });

  const response = await agent.invoke({ messages });

  // stubbed snapshots keep their ids, so the reducer overwrites the stored
  // full-size versions; the summarized middle is deleted explicitly
  const removals = compacted.removed
    .filter((m) => m.id)
    .map((m) => new RemoveMessage({ id: m.id! }));

  return {
    messages: [...response.messages, ...removals],
    plans,
    summary: compacted.summary,
  };
}


// did the agent finish (or honestly track) its plan?
function planRouter(state: typeof State.State) {
  const pending = state.plans.filter((p) => p.status === "pending");
  if (pending.length === 0) return END;
  if (state.nudges >= MAX_NUDGES) {
    console.log("[router] pending plans remain but nudge limit reached, ending");
    return END;
  }
  console.log(`[router] ${pending.length} plan(s) still pending, sending back to agent`);
  return "nudge";
}


// a conditional edge can't modify state, so this node injects the retry message
function nudgeNode(state: typeof State.State) {
  const pending = state.plans.filter((p) => p.status === "pending");
  const list = pending.map((p) => `- [${p.id}] ${p.description}`).join("\n");
  return {
    nudges: state.nudges + 1,
    messages: [
      new HumanMessage(
        `You stopped, but these plan steps are still pending:\n${list}\n\n` +
          `Either finish them now, or if a step is already done, mark it completed with write_plan. ` +
          `If a step cannot be done, explain why to the user.`,
      ),
    ],
  };
}


const graphNode = new StateGraph(State)
  .addNode("agent", agentNode)
  .addNode("nudge", nudgeNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", planRouter, { nudge: "nudge", [END]: END })
  .addEdge("nudge", "agent");


const checkpointer = new MemorySaver();
export const graph = graphNode.compile({ checkpointer });
