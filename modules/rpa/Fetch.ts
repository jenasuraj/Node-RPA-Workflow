import {Request, Response} from "express";
import {getBrowser} from "../../lib/browser";

export default async function RpaFetchDataHandler(req: Request, res: Response) {

    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    try {
        
        await page.goto("https://edumerge-assignment-gamma.vercel.app/", {
        waitUntil: "domcontentloaded",
        });
        const bodyText = await page.locator("body").innerText();
        await page.getByRole("link", { name: "Admin / Counsellor Login" }).click();
        return res.status(200).json({ data: bodyText });
    }
        catch(err){
            const message = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ error: message });
        }
        finally {
            await context.close();
        }
    }