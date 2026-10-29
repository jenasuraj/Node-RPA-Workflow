import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { HumanMessage } from "@langchain/core/messages";
import { graph } from "./graph";

export default async function CallAiAgentHandler(req: Request, res: Response) {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Body must include a non-empty 'prompt' string." });
  }
  const thread_id = "3f2a9c";

  try {
    const result = await graph.invoke(
      { messages: [new HumanMessage(prompt)] },
      {
        configurable: { thread_id },
        recursionLimit: 100,
      },
    );
    res.json({
      prompt,
      response: result.messages.at(-1)?.content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
