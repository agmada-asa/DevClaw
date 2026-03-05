/**
 * linkedinProspector.ts
 *
 * Uses Playwright to search LinkedIn for startup founders and software
 * engineering leaders who are strong prospects for DevClaw.
 *
 * Session management: saves cookies to LINKEDIN_SESSION_PATH so subsequent
 * runs reuse the authenticated session without re-logging in.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RawProspect, LinkedInSearchConfig } from './types';

const LINKEDIN_BASE = 'https://www.linkedin.com';
const DEFAULT_SESSION_PATH = path.resolve(process.cwd(), 'linkedin-session.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const jitter = (baseMs: number): number =>
    baseMs + Math.floor(Math.random() * baseMs * 0.5);

// ─── Session Management ───────────────────────────────────────────────────────

const loadSessionCookies = async (sessionPath: string): Promise<object[] | null> => {
    try {
        const raw = await fs.readFile(sessionPath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const saveSessionCookies = async (context: BrowserContext, sessionPath: string): Promise<void> => {
    try {
        const cookies = await context.cookies();
        await fs.writeFile(sessionPath, JSON.stringify(cookies, null, 2), 'utf-8');
        console.log(`[LinkedInProspector] Session saved to ${sessionPath}`);
    } catch (err: any) {
        console.warn('[LinkedInProspector] Could not save session:', err.message);
    }
};

const isLoggedIn = async (page: Page): Promise<boolean> => {
    try {
        await page.goto(`${LINKEDIN_BASE}/feed`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const url = page.url();
        return !url.includes('/login') && !url.includes('/checkpoint');
    } catch {
        return false;
    }
};

// ─── Login ────────────────────────────────────────────────────────────────────

const loginToLinkedIn = async (page: Page, email: string, password: string): Promise<void> => {
    console.log('[LinkedInProspector] Logging into LinkedIn...');
    await page.goto(`${LINKEDIN_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(jitter(1000));

    await page.fill('#username', email);
    await sleep(jitter(500));
    await page.fill('#password', password);
    await sleep(jitter(500));

    await page.click('[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });

    const url = page.url();
    if (url.includes('/checkpoint') || url.includes('/challenge')) {
        throw new Error(
            'LinkedIn is requesting a verification challenge. ' +
            'Please log in manually once to complete verification, then re-run.'
        );
    }
    if (url.includes('/login')) {
        throw new Error('LinkedIn login failed — check LINKEDIN_EMAIL and LINKEDIN_PASSWORD.');
    }

    console.log('[LinkedInProspector] Login successful.');
};

// ─── Profile Extraction ───────────────────────────────────────────────────────

// Extract all prospect cards from the current search page in a single fast evaluate() call.
// Using page.evaluate() avoids Playwright's smart-waiting on individual locators which can hang.
const extractProspectsFromPage = async (page: Page): Promise<RawProspect[]> => {
    const LINKEDIN_BASE_URL = LINKEDIN_BASE;
    return page.evaluate((base) => {
        const CARD_SELECTOR = '[data-chameleon-result-urn], li.reusable-search__result-item, div.entity-result';
        const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
        const results: any[] = [];

        for (const card of cards) {
            try {
                // Profile URL
                const profileLink = card.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null;
                if (!profileLink) continue;
                const rawHref = profileLink.getAttribute('href') || '';
                const cleanHref = rawHref.split('?')[0];
                const profileUrl = cleanHref.startsWith('http') ? cleanHref : base + cleanHref;
                if (!profileUrl.includes('/in/')) continue;

                // Name — try old classes then new aria-hidden span
                const nameEl =
                    card.querySelector('span.entity-result__title-text') ||
                    card.querySelector('.artdeco-entity-lockup__title') ||
                    card.querySelector('span[aria-hidden="true"]');
                const fullName = nameEl?.textContent?.trim() || '';
                if (!fullName) continue;
                const nameParts = fullName.split(' ');
                const firstName = nameParts[0] || '';
                const lastName = nameParts.slice(1).join(' ') || '';

                // Title — old class or new "t-14 t-black" leaf div
                const titleEl =
                    card.querySelector('.entity-result__primary-subtitle') ||
                    card.querySelector('.artdeco-entity-lockup__subtitle') ||
                    card.querySelector('div[class*="t-14 t-black"]');
                const title = titleEl?.textContent?.trim() || '';

                // Company — old class only (new LinkedIn embeds company in title)
                const companyEl =
                    card.querySelector('.entity-result__secondary-subtitle') ||
                    card.querySelector('.artdeco-entity-lockup__caption');
                const companyName = companyEl?.textContent?.trim().split('\n')[0] || '';

                // Location — old class or new "t-14 t-normal" div
                const locationEl =
                    card.querySelector('.entity-result__location') ||
                    card.querySelector('.artdeco-entity-lockup__metadata') ||
                    card.querySelector('div[class*="t-14 t-normal"]');
                const location = locationEl?.textContent?.trim() || '';

                // Connection degree from card text
                const cardText = card.textContent || '';
                const connectionDegree: '1st' | '2nd' | '3rd+' =
                    cardText.includes('1st') ? '1st' :
                    cardText.includes('2nd') ? '2nd' : '3rd+';

                results.push({ firstName, lastName, title, companyName, linkedinProfileUrl: profileUrl, location: location || undefined, connectionDegree });
            } catch {
                // skip malformed cards
            }
        }
        return results;
    }, LINKEDIN_BASE_URL);
};

// ─── Search ───────────────────────────────────────────────────────────────────

const buildSearchUrl = (query: string, page: number = 1): string => {
    const encoded = encodeURIComponent(query);
    return `${LINKEDIN_BASE}/search/results/people/?keywords=${encoded}&origin=GLOBAL_SEARCH_HEADER&page=${page}`;
};

const scrapeSearchPage = async (
    page: Page,
    searchUrl: string,
    delayMs: number
): Promise<RawProspect[]> => {
    // LinkedIn may interrupt navigation with service worker — ignore that error
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await sleep(jitter(delayMs));

    // Wait for results to load (LinkedIn updated to use data-chameleon-result-urn)
    const CARD_SELECTOR = '[data-chameleon-result-urn], li.reusable-search__result-item, div.entity-result';
    try {
        await page.waitForSelector(CARD_SELECTOR, { timeout: 15_000 });
    } catch {
        console.warn('[LinkedInProspector] No results found on page, skipping.');
        return [];
    }

    // Scroll down to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(jitter(1000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(jitter(1000));

    // Extract all cards at once using fast DOM evaluate (avoids Playwright locator timeouts)
    const prospects = await extractProspectsFromPage(page);
    console.log(`[LinkedInProspector] Found ${prospects.length} cards on page`);

    return prospects;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const discoverProspects = async (config: LinkedInSearchConfig): Promise<RawProspect[]> => {
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;
    const sessionPath = process.env.LINKEDIN_SESSION_PATH || DEFAULT_SESSION_PATH;
    const headless = process.env.LINKEDIN_HEADLESS !== 'false';

    if (!email || !password) {
        throw new Error(
            'LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in environment. ' +
            'These are used for a single login; session is saved for reuse.'
        );
    }

    const browser: Browser = await chromium.launch({
        headless,
        // Use system Chromium when CHROMIUM_PATH is set (Docker/CI).
        // Falls back to Playwright's bundled Chromium in local dev.
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context: BrowserContext = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
    });

    // Load saved session cookies
    const savedCookies = await loadSessionCookies(sessionPath);
    if (savedCookies && savedCookies.length > 0) {
        await context.addCookies(savedCookies as any);
        console.log('[LinkedInProspector] Loaded saved session cookies.');
    }

    const page: Page = await context.newPage();
    const allProspects: RawProspect[] = [];

    try {
        // Check if existing session is still valid
        const loggedIn = await isLoggedIn(page);
        if (!loggedIn) {
            await loginToLinkedIn(page, email, password);
            await saveSessionCookies(context, sessionPath);
        }

        // Search across multiple pages until we hit maxResults
        let pageNum = 1;
        const maxPages = Math.ceil(config.maxResults / 10);

        while (allProspects.length < config.maxResults && pageNum <= maxPages) {
            console.log(
                `[LinkedInProspector] Searching page ${pageNum}/${maxPages} ` +
                `for "${config.query}" (${allProspects.length}/${config.maxResults} found)`
            );

            const url = buildSearchUrl(config.query, pageNum);
            const pageProspects = await scrapeSearchPage(page, url, config.delayBetweenActionsMs);

            allProspects.push(...pageProspects);
            pageNum++;

            if (pageProspects.length === 0) {
                console.log('[LinkedInProspector] No more results, stopping search.');
                break;
            }

            if (allProspects.length < config.maxResults) {
                await sleep(jitter(config.delayBetweenActionsMs));
            }
        }

        console.log(`[LinkedInProspector] Discovery complete: ${allProspects.length} raw prospects found.`);
        return allProspects.slice(0, config.maxResults);
    } finally {
        await browser.close();
    }
};
