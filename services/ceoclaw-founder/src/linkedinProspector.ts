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

const extractConnectionDegree = (cardText: string): RawProspect['connectionDegree'] => {
    if (cardText.includes('1st')) return '1st';
    if (cardText.includes('2nd')) return '2nd';
    return '3rd+';
};

const extractProspectFromCard = async (
    page: Page,
    cardLocator: any
): Promise<RawProspect | null> => {
    try {
        const cardText = await cardLocator.innerText().catch(() => '');

        // Profile URL — the name is always a link to the profile
        const profileLink = cardLocator.locator('a[href*="/in/"]').first();
        const profileHref = await profileLink.getAttribute('href').catch(() => null);
        if (!profileHref) return null;

        const profileUrl = profileHref.split('?')[0].startsWith('http')
            ? profileHref.split('?')[0]
            : `${LINKEDIN_BASE}${profileHref.split('?')[0]}`;

        // Name — try multiple selectors in order of specificity
        let fullName = '';
        const nameSelectors = [
            'span.entity-result__title-text',
            '.artdeco-entity-lockup__title',
            'span[aria-hidden="true"]',
        ];
        for (const sel of nameSelectors) {
            const el = cardLocator.locator(sel).first();
            const text = await el.innerText().catch(() => '');
            if (text.trim()) { fullName = text.trim(); break; }
        }
        if (!fullName) return null;

        const nameParts = fullName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Title & Company
        let title = '';
        let companyName = '';
        const subtitleSelectors = [
            '.entity-result__primary-subtitle',
            '.artdeco-entity-lockup__subtitle',
        ];
        for (const sel of subtitleSelectors) {
            const el = cardLocator.locator(sel).first();
            const text = await el.innerText().catch(() => '');
            if (text.trim()) { title = text.trim(); break; }
        }

        const secondarySelectors = [
            '.entity-result__secondary-subtitle',
            '.artdeco-entity-lockup__caption',
        ];
        for (const sel of secondarySelectors) {
            const el = cardLocator.locator(sel).first();
            const text = await el.innerText().catch(() => '');
            if (text.trim()) { companyName = text.trim().split('\n')[0]; break; }
        }

        // Location
        let location = '';
        const locationSelectors = ['.entity-result__location', '.artdeco-entity-lockup__metadata'];
        for (const sel of locationSelectors) {
            const el = cardLocator.locator(sel).first();
            const text = await el.innerText().catch(() => '');
            if (text.trim()) { location = text.trim(); break; }
        }

        if (!firstName) return null;

        return {
            firstName,
            lastName,
            title,
            companyName,
            linkedinProfileUrl: profileUrl,
            location: location || undefined,
            connectionDegree: extractConnectionDegree(cardText),
        };
    } catch (err: any) {
        console.warn('[LinkedInProspector] Failed to extract card:', err.message);
        return null;
    }
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
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(jitter(delayMs));

    // Wait for results to load
    try {
        await page.waitForSelector(
            'li.reusable-search__result-item, div.entity-result',
            { timeout: 15_000 }
        );
    } catch {
        console.warn('[LinkedInProspector] No results found on page, skipping.');
        return [];
    }

    // Scroll down to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(jitter(1000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(jitter(1000));

    const cardLocators = page.locator(
        'li.reusable-search__result-item, div.entity-result'
    );
    const count = await cardLocators.count();
    console.log(`[LinkedInProspector] Found ${count} cards on page`);

    const prospects: RawProspect[] = [];
    for (let i = 0; i < count; i++) {
        const card = cardLocators.nth(i);
        const prospect = await extractProspectFromCard(page, card);
        if (prospect) prospects.push(prospect);
        await sleep(jitter(200));
    }

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
