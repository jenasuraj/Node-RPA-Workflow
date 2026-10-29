import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Locator, Page } from "playwright";
import { getBrowser } from "../../lib/browser";


// shared tab so back/forward act on the page the agent visited
let currentPage: Page | null = null;

// ref -> element map built by read_page; anything that changes the page must clear it
const refs = new Map<string, Locator>();

function clearRefs() {
  refs.clear();
}


// how much of the page we let into the LLM's context per read_page call
const MAX_VISIBLE_TEXT_CHARS = 3000;
const MAX_INTERACTIVE_ELEMENTS = 150;
const MAX_LABEL_CHARS = 80;


async function snapshotPage(page: Page): Promise<string> {
  const selector =
    'a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
  const elements = await page.locator(selector).filter({ visible: true }).all();

  clearRefs();
  const lines: string[] = [];
  for (let i = 0; i < elements.length && i < MAX_INTERACTIVE_ELEMENTS; i++) {
    const el = elements[i];
    // one evaluate per element: tag, input type, label text and current value
    const info = await el
      .evaluate((node) => {
        const e = node as HTMLElement;
        const tag = e.tagName.toLowerCase();
        const type = e.getAttribute("type") ?? "";
        const value = (e as HTMLInputElement).value ?? "";
        const label =
          e.innerText?.trim() ||
          e.getAttribute("aria-label") ||
          e.getAttribute("placeholder") ||
          e.getAttribute("name") ||
          "";
        return { tag, type, value, label };
      })
      .catch(() => null);
    if (!info || (!info.label && !info.value)) continue;

    const ref = `e${i}`;
    refs.set(ref, el);

    const kind = info.tag === "input" && info.type ? `input[${info.type}]` : info.tag;
    const valuePart =
      (info.tag === "input" || info.tag === "textarea") && info.value
        ? ` value="${info.value.slice(0, MAX_LABEL_CHARS)}"`
        : "";
    lines.push(`[${ref}] ${kind} "${info.label.slice(0, MAX_LABEL_CHARS)}"${valuePart}`);
  }

  let visibleText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  visibleText = visibleText.replace(/\n{3,}/g, "\n\n").trim();
  const truncated = visibleText.length > MAX_VISIBLE_TEXT_CHARS;
  visibleText = visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS);

  return [
    `URL: ${page.url()}`,
    `Title: "${await page.title()}"`,
    "",
    "## Visible text" + (truncated ? " (truncated)" : ""),
    visibleText || "(no visible text)",
    "",
    "## Interactive elements (click/fill these by ref)",
    lines.length ? lines.join("\n") : "(none found)",
  ].join("\n");
}


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
  },
);


export const pageVisiter = tool(
  async ({ url }) => {
    console.log(`[tool] website_visiter called with url=${url}`);
    const page = await getPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    clearRefs();
    return `Visited ${url}. Page title: "${await page.title()}". Call read_page to see its content.`;
  },
  {
    // tool names must match ^[a-zA-Z0-9_-]+$ or the LLM API rejects the request
    name: "website_visiter",
    description: "use this tool to visit a webpage via providing its url",
    schema: z.object({
      url: z.string().describe("The url in https format of the site you want to visit"),
    }),
  },
);


export const browserBack = tool(
  async () => {
    console.log("[tool] browser_back called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    // goBack resolves to null when there is no previous page in history
    const response = await currentPage.goBack({ waitUntil: "domcontentloaded" });
    if (!response) return "Cannot go back: no previous page in history.";
    clearRefs();
    return `Went back to ${currentPage.url()}. Page title: "${await currentPage.title()}"`;
  },
  {
    name: "browser_back",
    description: "Press the browser's back button to return to the previous page.",
    schema: z.object({}),
  },
);


export const browserForward = tool(
  async () => {
    console.log("[tool] browser_forward called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    const response = await currentPage.goForward({ waitUntil: "domcontentloaded" });
    if (!response) return "Cannot go forward: no next page in history.";
    clearRefs();
    return `Went forward to ${currentPage.url()}. Page title: "${await currentPage.title()}"`;
  },
  {
    name: "browser_forward",
    description: "Press the browser's forward button to go to the next page after going back.",
    schema: z.object({}),
  },
);


export const readPage = tool(
  async () => {
    console.log("[tool] read_page called");
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    return await snapshotPage(currentPage);
  },
  {
    name: "read_page",
    description:
      "Get a compact snapshot of the current page: its visible text plus every clickable/fillable element with a ref like [e12]. Use those refs with browser_click. Call this again after every navigation or click, because refs from an old snapshot stop working.",
    schema: z.object({}),
  },
);


export const browserClick = tool(
  async ({ ref }) => {
    console.log(`[tool] browser_click called with ref="${ref}"`);
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    const el = refs.get(ref);
    if (!el)
      return `Unknown ref "${ref}". Refs come from the latest read_page snapshot and reset on navigation. Call read_page and use a ref from its output.`;
    await el.click();
    // the click may have navigated or re-rendered the page, so old refs are stale
    clearRefs();
    await currentPage.waitForLoadState("domcontentloaded").catch(() => {});
    return `Clicked [${ref}], now on ${currentPage.url()}. Page title: "${await currentPage.title()}". Call read_page to see the page's new state.`;
  },
  {
    name: "browser_click",
    description:
      "Click an element on the current page by its ref from the latest read_page snapshot, e.g. 'e13'.",
    schema: z.object({
      ref: z.string().describe("The element ref from the latest read_page snapshot, e.g. 'e13'"),
    }),
  },
);


export const inputForm = tool(
  async ({ form }) => {
    console.log(`[tool] input_form called with form=${JSON.stringify(form)}`);
    if (!currentPage || currentPage.isClosed()) return "No page is open. Visit a website first.";
    if (Object.keys(form).length == 0)
      return "the object for input field label and its value is not there";

    for (let key of Object.keys(form)) {
      await currentPage.getByLabel(key).fill(form[key]);
    }
    return `input data added for fields ${Object.keys(form).join(", ")}`;
  },
  {
    name: "input_form",
    description:
      "use this tool to type values into form fields on the current page. Keys are the field's visible label or placeholder, values are what to type.",
    schema: z.object({
      form: z
        .record(z.string(), z.string())
        .describe(
          'Field label or placeholder -> value to type, e.g. { "Name": "Suraj", "Email": "suraj@example.com" }',
        ),
    }),
  },
);


export const tools = [
  dummyWeatherTool,
  pageVisiter,
  browserBack,
  browserForward,
  readPage,
  browserClick,
  inputForm,
];
