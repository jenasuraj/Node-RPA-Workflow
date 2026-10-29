import { ChatOpenAI } from "@langchain/openai";

export function getLLM(model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini") {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your .env file.");
  }

 return new ChatOpenAI({
  model,
  apiKey,
  temperature: 0.7,
  maxTokens: 1000,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});
}