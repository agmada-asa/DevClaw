/**
 * findProfile.ts — Searches LinkedIn for a name and prints the profile URL.
 * Usage: npx ts-node src/findProfile.ts "Ayomide Ojediran"
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { chromium } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const name = process.argv[2] || 'Ayomide Ojediran';
const sessionPath = process.env.LINKEDIN_SESSION_PATH || path.resolve(process.cwd(), 'linkedin-session.json');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    try {
        const raw = await fs.readFile(sessionPath, 'utf-8');
        await context.addCookies(JSON.parse(raw));
    } catch {}

    const page = await context.newPage();
    const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.waitForSelector('[data-chameleon-result-urn], li.reusable-search__result-item', { timeout: 10_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const results = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="/in/"]'))
            .map(a => (a as HTMLAnchorElement).href.split('?')[0])
            .filter((v, i, arr) => v.includes('/in/') && arr.indexOf(v) === i)
            .slice(0, 5);
    });

    console.log(`Results for "${name}":`);
    results.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    await browser.close();
})();
