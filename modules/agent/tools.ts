import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Page } from "playwright";
import { getBrowser } from "../../lib/browser";


// shared tab so back/forward act on the page the agent visited
let currentPage: Page | null = null;

async function getPage(): Promise<Page> {
  if (!currentPage || currentPage.isClosed()) {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: null });
    currentPage = await context.newPage();
  }
  return currentPage;
}


export const dummyWeatherTool = tool(
  async ({ location }) => {
    console.log(`[tool] dummy_weather_tool called with location=${location}`);
    return `The weather in ${location} is sunny.`;
  },
  {
    name: "dummy_weather_tool",
    description: "A simple dummy tool for fetching weather information.",
    schema: z.object({
      location: z.string().describe("The location for which to fetch weather information"),
    }),
  }
);


export const pageVisiter = tool(
  async ({ url }) => {
    console.log(`[tool] website_visiter called with url=${url}`);
    const page = await getPage();
    await page.goto(url, {
        waitUntil: "domcontentloaded",
    });
    return `Visited ${url}. Page title: "${await page.title()}"`;
  },

  {
    // tool names must match ^[a-zA-Z0-9_-]+$ (no spaces), or the LLM API rejects the request
    name: "website_visiter",
    description: "use this tool to visit a webpage via providing its url",
    schema: z.object({
      url: z.string().describe("The url in https format of the site you want to visit"),
    }),
  }
);


export const browserBack = tool(
  async () => {
    console.log("[tool] browser_back called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    // goBack resolves to null when there is no previous page in history
    const response = await currentPage.goBack({ waitUntil: "domcontentloaded" });
    if (!response) return "Cannot go back: no previous page in history.";
    return `Went back to ${currentPage.url()}. Page title: "${await currentPage.title()}"`;
  },
  {
    name: "browser_back",
    description: "Press the browser's back button to return to the previous page.",
    schema: z.object({}),
  }
);


export const browserForward = tool(
  async () => {
    console.log("[tool] browser_forward called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    const response = await currentPage.goForward({ waitUntil: "domcontentloaded" });
    if (!response) return "Cannot go forward: no next page in history.";
    return `Went forward to ${currentPage.url()}. Page title: "${await currentPage.title()}"`;
  },
  {
    name: "browser_forward",
    description: "Press the browser's forward button to go to the next page after going back.",
    schema: z.object({}),
  }
);


export const readPage = tool(
  async () => {
    console.log("[tool] read_page called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    const html = await currentPage.content();
    return "here is the entire html content of the page which is opened"  + html;
  },
  {
    name: "read_page",
    description: "Get the HTML of the current page, to see its content and which buttons or links can be clicked.",
    schema: z.object({}),
  }
);


export const browserClick = tool(
  async ({ text }) => {
    console.log(`[tool] browser_click called with text="${text}"`);
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    await currentPage.getByText(text).first().click();
    await currentPage.waitForTimeout(5000);
    return `Clicked the button or link with text "${text}", now on ${currentPage.url()}. Page title: "${await currentPage.title()}"`;
  },
  {
    name: "browser_click",
    description: "Click a button or link on the current page by its visible text.",
    schema: z.object({
      text: z.string().describe("The visible text of the button or link, e.g. 'Contact / Admission Enquiry'"),
    }),
  }
);


export const inputForm = tool(
  // form's type comes from the zod schema below: Record<string, string>
  async ({ form }) => {
    console.log(`[tool] input_form called with form=${JSON.stringify(form)}`);
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    if (Object.keys(form).length == 0) return "the object for input field label and its value is not there"

    for(let key of Object.keys(form))
    {
      await currentPage.getByLabel(key).fill(form[key]);
    }
    return `input data added for fields ${Object.keys(form).join(", ")}`
  },
  {
    name: "input_form",
    description: "use this tool to type values into form fields on the current page. Keys are the field's visible label or placeholder, values are what to type.",
    schema: z.object({
      form: z
        .record(z.string(), z.string())
        .describe('Field label or placeholder -> value to type, e.g. { "Name": "Suraj", "Email": "suraj@example.com" }'),
    }),
  }
);


export const tools = [dummyWeatherTool, pageVisiter, browserBack, browserForward, readPage, browserClick, inputForm];