import { Annotation, END, MemorySaver, START, StateGraph, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { getLLM } from "../../lib/llm";
import { AGENT_PROMPT } from "./prompts";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tools } from "./tools";



const agent = createReactAgent({
  llm: getLLM(),
  tools: tools,
  prompt: AGENT_PROMPT ,
});

// langgraph state to track messages ...
export const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});


async function writer(state: typeof State.State) {
  // agent.invoke returns the agent's full state ({ messages }), not a single message
  const response = await agent.invoke({ messages: state.messages });
  return { messages: response.messages };
}



const graphNode = new StateGraph(State)
  .addNode("writer", writer)
  .addEdge(START, "writer")
  .addEdge("writer", END);


const checkpointer = new MemorySaver();
export const graph = graphNode.compile({ checkpointer });