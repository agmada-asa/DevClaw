/**
 * debugProfile.ts — Dumps all clickable elements near the profile header
 * to find what LinkedIn actually renders for Connect/Follow/Message/Pending.
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { chromium } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const PROFILE_URL = 'https://www.linkedin.com/in/mideyy7/';
const sessionPath = process.env.LINKEDIN_SESSION_PATH || path.resolve(process.cwd(), 'linkedin-session.json');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
    });
    try {
        const raw = await fs.readFile(sessionPath, 'utf-8');
        await context.addCookies(JSON.parse(raw));
    } catch { }

    const page = await context.newPage();
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});

    // Wait for profile card
    await page.waitForSelector('.pv-top-card, .pvs-profile-actions, .ph5, main section', { timeout: 10_000 }).catch(() => {});
    // Scroll to top to ensure profile header is visible
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate(() => {
        // All clickable elements (button, a, div[role=button], span[role=button])
        const clickable = Array.from(document.querySelectorAll(
            'button, a[href], [role="button"], [tabindex="0"]'
        )).slice(0, 60).map((el, i) => ({
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 80) || '',
            aria: el.getAttribute('aria-label') || '',
            href: (el as HTMLAnchorElement).href || '',
            index: i,
        }));

        // Specifically look for Connect/Pending/Message in ANY element
        const connectEls = Array.from(document.querySelectorAll('*'))
            .filter(el => {
                const t = el.textContent?.trim() || '';
                const a = el.getAttribute('aria-label') || '';
                return (t === 'Connect' || t === 'Pending' || t === 'Message' || t === 'Follow' ||
                    a.includes('Connect') || a.includes('Pending'));
            })
            .slice(0, 10)
            .map(el => ({
                tag: el.tagName,
                text: el.textContent?.trim().slice(0, 80),
                aria: el.getAttribute('aria-label'),
                classes: el.className?.toString().slice(0, 80),
            }));

        return { clickable: clickable.slice(0, 30), connectEls };
    });

    console.log('\n=== CONNECT-RELATED ELEMENTS ===');
    result.connectEls.forEach(e => console.log(e));

    console.log('\n=== FIRST 30 CLICKABLE ELEMENTS ===');
    result.clickable.forEach(e =>
        console.log(`[${e.index}] <${e.tag}> aria="${e.aria}" text="${e.text}"`)
    );

    await browser.close();
})();
