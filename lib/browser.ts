import { chromium, Browser } from "playwright";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // In Docker: no display and no Google Chrome, so use Playwright's bundled Chromium headless
    const isProd = process.env.NODE_ENV === "production";
    browser = await chromium.launch({
      channel: isProd ? undefined : "chrome",
      headless: isProd,
    });
  }
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
}
