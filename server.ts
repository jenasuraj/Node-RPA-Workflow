import express, { Request, Response } from "express";
import FirstRPAHandler from "./modules/rpa/first";
import RpaFetchDataHandler from "./modules/rpa/Fetch";
import CallAiAgentHandler from "./modules/agent/handler";


export const app = express();
app.use(express.json());

app.get("/rpa-fetch-data", RpaFetchDataHandler);
app.post("/first-rpa", FirstRPAHandler);
app.post("/call-ai-agent", CallAiAgentHandler);

// Only start listening when run directly, so tests can import `app`
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 4000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}