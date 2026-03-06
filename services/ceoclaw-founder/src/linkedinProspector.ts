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

const hasLinkedInSessionCookie = async (context: BrowserContext): Promise<boolean> => {
    try {
        const cookies = await context.cookies(LINKEDIN_BASE);
        return cookies.some((cookie) => cookie.name === 'li_at' && typeof cookie.value === 'string' && cookie.value.length > 0);
    } catch {
        return false;
    }
};

const isLoggedInWithoutNavigation = async (page: Page, context: BrowserContext): Promise<boolean> => {
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/challenge') || url.includes('/uas/login')) {
        return false;
    }

    if (await hasLinkedInSessionCookie(context)) {
        return true;
    }

    const hasAuthenticatedUi = await page
        .locator('#global-nav, nav.global-nav, .global-nav, [data-test-global-nav]')
        .first()
        .isVisible()
        .catch(() => false);
    return hasAuthenticatedUi;
};

const getPageDiagnostics = async (page: Page): Promise<string> => {
    const url = page.url();
    const title = await page.title().catch(() => 'unknown');
    const bodySnippet = await page
        .evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 240))
        .catch(() => '');
    return `url=${url} title="${title}" bodySnippet="${bodySnippet}"`;
};

const firstUsableSelector = async (page: Page, selectors: string[]): Promise<string | null> => {
    for (const selector of selectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);
        if (count <= 0) continue;

        for (let i = 0; i < count; i += 1) {
            const candidate = locator.nth(i);
            const usable = await candidate
                .evaluate((el) => {
                    if (!(el instanceof HTMLElement)) return false;
                    const input = el as HTMLInputElement | HTMLTextAreaElement;
                    const style = window.getComputedStyle(el);
                    const isHiddenType =
                        'type' in input && typeof input.type === 'string' && input.type.toLowerCase() === 'hidden';
                    const isVisible =
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        el.getBoundingClientRect().width > 0 &&
                        el.getBoundingClientRect().height > 0;
                    const isEditable = !input.disabled && !(input as any).readOnly;
                    return !isHiddenType && isVisible && isEditable;
                })
                .catch(() => false);

            if (usable) return selector;
        }
    }
    return null;
};

const hasChallengeSignals = async (page: Page): Promise<boolean> => {
    const url = page.url();
    if (url.includes('/checkpoint') || url.includes('/challenge')) return true;

    const text = await page
        .evaluate(() => (document.body?.innerText || '').toLowerCase())
        .catch(() => '');

    return (
        text.includes('captcha') ||
        text.includes('security verification') ||
        text.includes('verify your identity') ||
        text.includes('unusual activity')
    );
};

const dismissCookieConsentIfPresent = async (page: Page): Promise<void> => {
    const consentButtons = [
        '#onetrust-accept-btn-handler',
        'button[action-type="ACCEPT"]',
        'button:has-text("Accept")',
        'button:has-text("Accept all")',
        'button:has-text("Accept cookies")',
        'button:has-text("I agree")',
    ];

    for (const selector of consentButtons) {
        const button = page.locator(selector).first();
        const visible = await button.isVisible().catch(() => false);
        if (!visible) continue;

        await button.click({ timeout: 3000 }).catch(() => { });
        await sleep(400);
        console.log(`[LinkedInProspector] Dismissed cookie/consent prompt via selector: ${selector}`);
        return;
    }
};

const getInputDiagnostics = async (page: Page): Promise<string> => {
    const inputs = await page
        .evaluate(() => {
            return Array.from(document.querySelectorAll('input')).slice(0, 20).map((el) => {
                const input = el as HTMLInputElement;
                const rect = input.getBoundingClientRect();
                const style = window.getComputedStyle(input);
                const visible =
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0;
                return {
                    name: input.name || '',
                    id: input.id || '',
                    type: input.type || '',
                    autocomplete: input.autocomplete || '',
                    visible,
                    disabled: input.disabled,
                    readOnly: input.readOnly,
                };
            });
        })
        .catch(() => []);

    return `inputs=${JSON.stringify(inputs)}`;
};

const waitForManualLogin = async (page: Page, context: BrowserContext, timeoutMs: number): Promise<boolean> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await isLoggedInWithoutNavigation(page, context)) {
            return true;
        }
        await sleep(2000);
    }
    return false;
};

// ─── Login ────────────────────────────────────────────────────────────────────

const loginToLinkedIn = async (
    context: BrowserContext,
    page: Page,
    email: string,
    password: string,
    headless: boolean,
    manualLoginTimeoutMs: number
): Promise<void> => {
    const EMAIL_SELECTORS = [
        '#username',
        'input[autocomplete="username"]',
        'input[name="session_key"]:not([type="hidden"])',
        'input[type="email"]',
        'input[name="email"]',
    ];
    const PASSWORD_SELECTORS = [
        '#password',
        'input[autocomplete="current-password"]',
        'input[name="session_password"]:not([type="hidden"])',
        'input[type="password"]',
    ];
    const SUBMIT_SELECTORS = ['button[type="submit"]', '[type="submit"]'];

    console.log('[LinkedInProspector] Logging into LinkedIn...');
    await page.goto(`${LINKEDIN_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(jitter(1000));

    await dismissCookieConsentIfPresent(page);
    await sleep(300);

    if (await isLoggedIn(page)) {
        console.log('[LinkedInProspector] Already logged in via existing session.');
        return;
    }

    if (await hasChallengeSignals(page)) {
        if (!headless) {
            console.log(
                '[LinkedInProspector] Challenge detected before login form. ' +
                `Please complete login manually in the opened browser within ${manualLoginTimeoutMs}ms.`
            );
            const manuallyLoggedIn = await waitForManualLogin(page, context, manualLoginTimeoutMs);
            if (manuallyLoggedIn) {
                console.log('[LinkedInProspector] Manual login detected; continuing.');
                return;
            }
        }
        throw new Error(
            'LinkedIn is requesting a verification challenge before login. ' +
            `Please complete manual login/challenge once and re-run. ${await getPageDiagnostics(page)}`
        );
    }

    const emailSelector = await firstUsableSelector(page, EMAIL_SELECTORS);
    const passwordSelector = await firstUsableSelector(page, PASSWORD_SELECTORS);
    const submitSelector = await firstUsableSelector(page, SUBMIT_SELECTORS);

    if (!emailSelector || !passwordSelector || !submitSelector) {
        if (!headless) {
            console.log(
                '[LinkedInProspector] Login form not automatable on this page variant. ' +
                `Please complete login manually in the opened browser within ${manualLoginTimeoutMs}ms.`
            );
            const manuallyLoggedIn = await waitForManualLogin(page, context, manualLoginTimeoutMs);
            if (manuallyLoggedIn) {
                console.log('[LinkedInProspector] Manual login detected; continuing.');
                return;
            }
        }
        throw new Error(
            'LinkedIn login form was not detected. ' +
            `Possible challenge/captcha/markup change. ${await getPageDiagnostics(page)} ` +
            `${await getInputDiagnostics(page)}`
        );
    }

    await page.fill(emailSelector, email);
    await sleep(jitter(500));
    await page.fill(passwordSelector, password);
    await sleep(jitter(500));

    await page.click(submitSelector);
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (await hasChallengeSignals(page)) {
        if (!headless) {
            console.log(
                '[LinkedInProspector] Challenge detected after submit. ' +
                `Please complete verification manually within ${manualLoginTimeoutMs}ms.`
            );
            const manuallyLoggedIn = await waitForManualLogin(page, context, manualLoginTimeoutMs);
            if (manuallyLoggedIn) {
                console.log('[LinkedInProspector] Manual verification/login detected; continuing.');
                return;
            }
        }
        throw new Error(
            'LinkedIn is requesting a verification challenge. ' +
            `Please log in manually once to complete verification, then re-run. ${await getPageDiagnostics(page)}`
        );
    }

    const url = page.url();
    if (url.includes('/login')) {
        throw new Error(
            'LinkedIn login failed — check LINKEDIN_EMAIL and LINKEDIN_PASSWORD. ' +
            `${await getPageDiagnostics(page)}`
        );
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
    delayMs: number,
    pageNum: number
): Promise<RawProspect[]> => {
    // LinkedIn may interrupt navigation with service worker — ignore that error
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
    await sleep(jitter(delayMs));

    // Wait for results to load (LinkedIn updated to use data-chameleon-result-urn)
    const CARD_SELECTOR = '[data-chameleon-result-urn], li.reusable-search__result-item, div.entity-result';
    try {
        await page.waitForSelector(CARD_SELECTOR, { timeout: 15_000 });
    } catch {
        const currentUrl = page.url();
        const pageTitle = await page.title().catch(() => 'unknown');
        const bodySnippet = await page
            .evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 220))
            .catch(() => '');

        if (pageNum === 1) {
            throw new Error(
                'LinkedIn search results did not load on page 1. ' +
                `Possible auth/challenge/selector issue. url=${currentUrl} title="${pageTitle}" ` +
                `bodySnippet="${bodySnippet}"`
            );
        }

        console.warn(
            `[LinkedInProspector] No results found on page ${pageNum}, stopping pagination. ` +
            `url=${currentUrl} title="${pageTitle}"`
        );
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
    const manualLoginTimeoutMs = Number.parseInt(process.env.LINKEDIN_MANUAL_LOGIN_TIMEOUT_MS || '180000', 10);

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
            await loginToLinkedIn(context, page, email, password, headless, manualLoginTimeoutMs);
            await saveSessionCookies(context, sessionPath);
        }

        // Search across multiple pages until we hit maxResults
        let pageNum = 1;
        const maxPages = Math.ceil(config.maxResults / 10);
        const startedAtMs = Date.now();
        const maxDurationMs = typeof config.maxDurationMs === 'number' && config.maxDurationMs > 0
            ? config.maxDurationMs
            : undefined;
        let timeboxReached = false;

        while (allProspects.length < config.maxResults && pageNum <= maxPages) {
            if (maxDurationMs !== undefined && (Date.now() - startedAtMs) >= maxDurationMs) {
                timeboxReached = true;
                await config.onProgress?.({
                    page: pageNum,
                    maxPages,
                    found: allProspects.length,
                    maxResults: config.maxResults,
                    query: config.query,
                    timeboxReached: true,
                });
                console.log(
                    `[LinkedInProspector] Discovery timebox reached (${maxDurationMs}ms). ` +
                    `Stopping at ${allProspects.length} prospects.`
                );
                break;
            }

            console.log(
                `[LinkedInProspector] Searching page ${pageNum}/${maxPages} ` +
                `for "${config.query}" (${allProspects.length}/${config.maxResults} found)`
            );

            await config.onProgress?.({
                page: pageNum,
                maxPages,
                found: allProspects.length,
                maxResults: config.maxResults,
                query: config.query,
                timeboxReached: false,
            });

            const url = buildSearchUrl(config.query, pageNum);
            const pageProspects = await scrapeSearchPage(page, url, config.delayBetweenActionsMs, pageNum);

            allProspects.push(...pageProspects);
            await config.onProgress?.({
                page: pageNum,
                maxPages,
                found: allProspects.length,
                maxResults: config.maxResults,
                query: config.query,
                timeboxReached: false,
            });
            pageNum++;

            if (pageProspects.length === 0) {
                console.log('[LinkedInProspector] No more results, stopping search.');
                break;
            }

            if (allProspects.length < config.maxResults) {
                await sleep(jitter(config.delayBetweenActionsMs));
            }
        }

        if (!timeboxReached) {
            console.log(`[LinkedInProspector] Discovery complete: ${allProspects.length} raw prospects found.`);
        }
        return allProspects.slice(0, config.maxResults);
    } finally {
        await browser.close();
    }
};
