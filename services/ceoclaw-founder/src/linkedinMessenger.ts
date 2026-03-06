/**
 * linkedinMessenger.ts
 *
 * Uses Playwright to send LinkedIn connection requests (with a personalized note)
 * or direct messages (for 1st-degree connections) to qualified prospects.
 *
 * Respects CEOCLAW_DAILY_MESSAGE_LIMIT to avoid triggering LinkedIn rate limits.
 * Loads the same session created by linkedinProspector.ts.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const LINKEDIN_BASE = 'https://www.linkedin.com';
const DEFAULT_SESSION_PATH = path.resolve(process.cwd(), 'linkedin-session.json');
const CONNECTION_NOTE_LIMIT = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (baseMs: number): number => baseMs + Math.floor(Math.random() * baseMs * 0.5);

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// ─── Session ──────────────────────────────────────────────────────────────────

const loadSessionCookies = async (sessionPath: string): Promise<object[] | null> => {
    try {
        const raw = await fs.readFile(sessionPath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

// ─── Connection Request ───────────────────────────────────────────────────────

const sendConnectionRequest = async (
    page: Page,
    profileUrl: string,
    note: string,
    firstName?: string
): Promise<boolean> => {
    const truncatedNote = note.slice(0, CONNECTION_NOTE_LIMIT);

    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});

        // Wait for the profile action area to render (LinkedIn is a heavy SPA).
        // The profile card container loads after the nav bar — we need it before scanning buttons.
        await page.waitForSelector(
            '.pv-top-card, .pvs-profile-actions, .ph5, main section',
            { timeout: 10_000 }
        ).catch(() => {});
        await sleep(jitter(2000));

        let connected = false;

        // 1. Name-specific: "Invite [FirstName] to connect" — scoped to profile card if possible
        if (firstName) {
            const nameBtn = page.locator(`button[aria-label*="Invite ${firstName}"]`).first();
            const visible = await nameBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (visible) {
                await nameBtn.click();
                await sleep(jitter(1000));
                connected = true;
                console.log(`[LinkedInMessenger] Connected via name-specific button`);
            }
        }

        // 2. "More actions" (3-dots) dropdown — try this before generic selectors to avoid sidebar matches
        if (!connected) {
            // LinkedIn uses various aria-labels for the 3-dots menu on profile pages
            const moreBtn = page.locator([
                'button[aria-label*="More actions"]',
                'button[aria-label*="more actions"]',
                'button[aria-label*="profile actions"]',
                'button[aria-label*="More options"]',
            ].join(', ')).first();
            const moreVisible = await moreBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (moreVisible) {
                await moreBtn.click();
                await sleep(jitter(1000));
                const connectOption = page.locator(
                    '[role="menuitem"]:has-text("Connect"), [role="option"]:has-text("Connect")'
                ).first();
                const optionVisible = await connectOption.isVisible({ timeout: 3000 }).catch(() => false);
                if (optionVisible) {
                    await connectOption.click();
                    await sleep(jitter(1000));
                    connected = true;
                    console.log(`[LinkedInMessenger] Connected via More actions dropdown`);
                } else {
                    await page.keyboard.press('Escape');
                    await sleep(500);
                }
            }
        }

        // 3. Generic "Invite … to connect" — but only if it's NOT a sidebar-section button.
        //    We check the button's closest ancestor to ensure it's in the profile top section.
        if (!connected) {
            const inviteBtns = page.locator('button[aria-label*="Invite"][aria-label*="connect"]');
            const count = await inviteBtns.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                const btn = inviteBtns.nth(i);
                const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
                if (!visible) continue;
                // Confirm this button is in the profile actions area (not sidebar People You May Know)
                const inSidebar = await btn.evaluate((el) => {
                    const aside = el.closest('aside, [data-view-name*="pymk"], .artdeco-carousel');
                    return !!aside;
                }).catch(() => false);
                if (inSidebar) {
                    console.log(`[LinkedInMessenger] Skipping sidebar Invite button`);
                    continue;
                }
                await btn.click();
                await sleep(jitter(1000));
                connected = true;
                console.log(`[LinkedInMessenger] Connected via profile Invite button (index ${i})`);
                break;
            }
        }

        if (!connected) {
            console.warn(`[LinkedInMessenger] No Connect button found on ${profileUrl} — skipping`);
            return false;
        }

        // After clicking Connect, wait for the invitation modal to appear
        await sleep(jitter(1500));

        // Log modal buttons to see what LinkedIn is showing
        const modalButtons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button'))
                .map(b => ({ text: (b.textContent || '').trim().slice(0, 60), aria: b.getAttribute('aria-label') || '' }))
                .filter(b => b.aria || b.text);
        });
        console.log(`[LinkedInMessenger] Modal buttons: ${modalButtons.map(b => b.aria || b.text).join(' | ').slice(0, 400)}`);

        // Try to add a note — button text varies between "Add a note" and "Add a personalized note"
        const addNoteBtn = page.locator([
            'button:has-text("Add a note")',
            'button[aria-label*="Add a note"]',
            'button:has-text("personalized note")',
        ].join(', ')).first();
        const addNoteVisible = await addNoteBtn.isVisible({ timeout: 3000 }).catch(() => false);

        if (addNoteVisible) {
            await addNoteBtn.click();
            await sleep(jitter(800));
            const noteArea = page.locator('textarea[name="message"], #custom-message, textarea').first();
            const areaVisible = await noteArea.isVisible({ timeout: 3000 }).catch(() => false);
            if (areaVisible) {
                await noteArea.fill(truncatedNote);
                await sleep(jitter(500));
            }
        }

        // Submit — LinkedIn uses various labels: "Send invitation", "Send", "Send now", "Done"
        const sendBtn = page.locator([
            'button[aria-label*="Send invitation"]',
            'button[aria-label*="Send now"]',
            'button:has-text("Send invitation")',
            'button:has-text("Send now")',
            'button:has-text("Send")',
            'button:has-text("Done")',
        ].join(', ')).last();
        const sendVisible = await sendBtn.isVisible({ timeout: 8000 }).catch(() => false);
        if (!sendVisible) {
            console.warn(`[LinkedInMessenger] Send button not found in modal for ${profileUrl}`);
            return false;
        }
        await sendBtn.click();
        await sleep(jitter(1500));

        console.log(`[LinkedInMessenger] Connection request sent to ${profileUrl}`);
        return true;
    } catch (err: any) {
        console.error(`[LinkedInMessenger] Failed to connect with ${profileUrl}:`, err.message);
        return false;
    }
};

// ─── Direct Message (1st-degree connections) ──────────────────────────────────

const sendDirectMessage = async (
    page: Page,
    profileUrl: string,
    message: string
): Promise<boolean> => {
    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // Wait for profile card to render before looking for Message button
        await page.waitForSelector('.pv-top-card, .pvs-profile-actions, .ph5, main section', { timeout: 10_000 }).catch(() => {});
        await sleep(jitter(2000));

        // Find the Message compose link by href — more reliable than text matching since
        // "Messaging" nav link also contains the substring "Message".
        // LinkedIn's Message CTA on profiles links to /messaging/compose/?profileUrn=...
        const composeHref = await page.evaluate(() => {
            const a = document.querySelector('a[href*="messaging/compose"]') as HTMLAnchorElement | null;
            return a?.href || null;
        });

        if (!composeHref) {
            // Fallback: try button with exact aria-label
            const msgBtn = page.locator('button[aria-label="Message"]').first();
            const btnVisible = await msgBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (!btnVisible) {
                console.warn(`[LinkedInMessenger] Message button not found on ${profileUrl}`);
                return false;
            }
            await msgBtn.click();
        } else {
            // Navigate directly to the compose URL — avoids all click overlay issues
            console.log(`[LinkedInMessenger] Navigating to compose URL: ${composeHref.slice(0, 80)}...`);
            await page.goto(composeHref, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
        }

        // Wait for the messaging page / overlay to load
        await page.waitForSelector(
            '.msg-form__contenteditable, [role="textbox"], div[contenteditable="true"], .msg-form',
            { timeout: 12_000 }
        ).catch(() => {});
        await sleep(jitter(1500));

        const postClickUrl = page.url();
        console.log(`[LinkedInMessenger] Messaging URL: ${postClickUrl.slice(0, 100)}`);

        // Comprehensive selectors for the compose text area across all LinkedIn messaging UI variants
        const composeArea = page.locator([
            '.msg-form__contenteditable',
            'div[role="textbox"][aria-label*="Write a message"]',
            'div[role="textbox"][aria-label*="message"]',
            'div[contenteditable="true"]',
            '.msg-form__message-texteditor div[contenteditable]',
            'div[data-artdeco-is-focused]',
        ].join(', ')).first();
        const composeVisible = await composeArea.isVisible({ timeout: 8000 }).catch(() => false);
        console.log(`[LinkedInMessenger] Compose area visible: ${composeVisible}`);
        if (!composeVisible) {
            console.warn(`[LinkedInMessenger] Compose area not found after clicking Message on ${profileUrl}`);
            return false;
        }
        await composeArea.click();
        await sleep(500);
        // Use pressSequentially for contenteditable divs — more reliable than fill() for rich text editors
        await composeArea.pressSequentially(message, { delay: 20 });
        await sleep(jitter(500));

        // Log what text ended up in the compose area
        const typedText = await composeArea.textContent().catch(() => '');
        console.log(`[LinkedInMessenger] Typed text (first 60 chars): "${typedText?.slice(0, 60)}"`);

        // Scan ALL buttons after typing to find the submit button (it appears at index 23+ in LinkedIn's DOM)
        const afterTypingBtns = await page.evaluate(() =>
            Array.from(document.querySelectorAll('button')).map((b, i) => ({
                i,
                text: b.textContent?.trim().slice(0, 50) || '',
                aria: b.getAttribute('aria-label') || '',
                type: b.getAttribute('type') || '',
                disabled: b.disabled,
            }))
        );

        // Find the real send button: type=submit, OR aria/text containing "send" (case-insensitive)
        const submitBtnInfo = afterTypingBtns.find(b =>
            b.type === 'submit' ||
            b.aria.toLowerCase().includes('send') ||
            b.text.toLowerCase() === 'send'
        );

        if (submitBtnInfo !== undefined) {
            console.log(`[LinkedInMessenger] Submit button at [${submitBtnInfo.i}]: aria="${submitBtnInfo.aria}" text="${submitBtnInfo.text}"`);
            await page.locator('button').nth(submitBtnInfo.i).click();
        } else {
            // Fallback: Enter key (works in LinkedIn chat overlay; on compose page adds newline but worth trying)
            console.log(`[LinkedInMessenger] No submit button found — pressing Enter in compose area`);
            await composeArea.press('Enter');
        }
        await sleep(jitter(1500));

        console.log(`[LinkedInMessenger] Direct message sent to ${profileUrl}`);
        return true;
    } catch (err: any) {
        console.error(`[LinkedInMessenger] Failed to message ${profileUrl}:`, err.message);
        return false;
    }
};

// ─── Connection Acceptance Check ─────────────────────────────────────────────
//
// Navigates to LinkedIn's sent-invitations manager and scrapes the profile URLs
// of requests that are STILL pending. The caller diffs this against the set of
// prospects with status='connection_sent' to identify who has accepted.

export const getPendingConnectionUrls = async (): Promise<string[]> => {
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;
    const sessionPath = process.env.LINKEDIN_SESSION_PATH || DEFAULT_SESSION_PATH;
    const headless = process.env.LINKEDIN_HEADLESS !== 'false';

    if (!email || !password) {
        throw new Error('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in environment.');
    }

    const browser: Browser = await chromium.launch({
        headless,
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

    const savedCookies = await loadSessionCookies(sessionPath);
    if (savedCookies && savedCookies.length > 0) {
        await context.addCookies(savedCookies as any);
    }

    const page: Page = await context.newPage();

    try {
        await page.goto(`${LINKEDIN_BASE}/feed`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const url = page.url();
        if (url.includes('/login') || url.includes('/checkpoint')) {
            throw new Error('LinkedIn session has expired. Delete linkedin-session.json and re-login.');
        }

        // Navigate to the sent invitations manager
        await page.goto(
            `${LINKEDIN_BASE}/mynetwork/invitation-manager/sent/`,
            { waitUntil: 'domcontentloaded', timeout: 20_000 }
        );
        await sleep(jitter(2000));

        // Scroll to load all pending requests
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await sleep(jitter(1000));
        }

        // Extract profile URLs of still-pending sent invitations
        const pendingUrls = await page.evaluate((base) => {
            const cards = Array.from(document.querySelectorAll(
                'li.invitation-card, [data-view-name="invitation-card"], .mn-invitation-item'
            ));
            const urls: string[] = [];
            for (const card of cards) {
                const link = card.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null;
                if (!link) continue;
                const href = link.getAttribute('href') || '';
                const clean = href.split('?')[0];
                const full = clean.startsWith('http') ? clean : base + clean;
                if (full.includes('/in/')) urls.push(full);
            }
            return urls;
        }, LINKEDIN_BASE);

        console.log(`[LinkedInMessenger] Found ${pendingUrls.length} still-pending connection requests.`);
        return pendingUrls;
    } finally {
        await browser.close();
    }
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OutreachTarget {
    prospectId: string;
    profileUrl: string;
    message: string;
    firstName?: string;
    lastName?: string;
    connectionDegree?: '1st' | '2nd' | '3rd+';
}

export interface OutreachResult {
    prospectId: string;
    profileUrl: string;
    sent: boolean;
    method: 'connection_request' | 'direct_message' | 'skipped';
    error?: string;
}

export interface SendOutreachBatchOptions {
    maxDurationMs?: number;
}

export const sendOutreachBatch = async (
    targets: OutreachTarget[],
    options: SendOutreachBatchOptions = {}
): Promise<OutreachResult[]> => {
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;
    const sessionPath = process.env.LINKEDIN_SESSION_PATH || DEFAULT_SESSION_PATH;
    const headless = process.env.LINKEDIN_HEADLESS !== 'false';
    const delayMs = parsePositiveInt(process.env.CEOCLAW_DELAY_BETWEEN_ACTIONS_MS, 4000);
    const dailyLimit = parsePositiveInt(process.env.CEOCLAW_DAILY_MESSAGE_LIMIT, 20);

    if (!email || !password) {
        throw new Error('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in environment.');
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

    const savedCookies = await loadSessionCookies(sessionPath);
    if (savedCookies && savedCookies.length > 0) {
        await context.addCookies(savedCookies as any);
    }

    const page: Page = await context.newPage();
    const results: OutreachResult[] = [];

    try {
        // Verify session
        await page.goto(`${LINKEDIN_BASE}/feed`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const url = page.url();
        if (url.includes('/login') || url.includes('/checkpoint')) {
            throw new Error(
                'LinkedIn session has expired. Delete linkedin-session.json and re-run to log in again.'
            );
        }

        const batchToProcess = targets.slice(0, dailyLimit);
        const startedAtMs = Date.now();
        console.log(
            `[LinkedInMessenger] Processing ${batchToProcess.length} outreach targets ` +
            `(daily limit: ${dailyLimit})`
        );

        for (const target of batchToProcess) {
            if (options.maxDurationMs !== undefined && (Date.now() - startedAtMs) >= options.maxDurationMs) {
                console.log(
                    `[LinkedInMessenger] Sending timebox reached (${options.maxDurationMs}ms). ` +
                    `Processed ${results.length}/${batchToProcess.length} targets.`
                );
                break;
            }

            const is1st = target.connectionDegree === '1st';
            let sent = false;
            let method: OutreachResult['method'] = 'skipped';

            try {
                if (is1st) {
                    // Existing 1st-degree connection — direct message
                    sent = await sendDirectMessage(page, target.profileUrl, target.message);
                    method = 'direct_message';
                } else {
                    // For 2nd/3rd-degree: try direct message first to catch "Open Profile" users
                    // (LinkedIn allows anyone to message Open Profile members directly).
                    // If the Message button is absent, fall back to a connection request with note.
                    console.log(`[LinkedInMessenger] Trying direct message for non-1st-degree (open profile check): ${target.profileUrl}`);
                    const directSent = await sendDirectMessage(page, target.profileUrl, target.message);
                    if (directSent) {
                        sent = true;
                        method = 'direct_message';
                        console.log(`[LinkedInMessenger] Open profile detected — sent direct message to ${target.profileUrl}`);
                    } else {
                        sent = await sendConnectionRequest(page, target.profileUrl, target.message, target.firstName);
                        method = 'connection_request';
                    }
                }

                results.push({ prospectId: target.prospectId, profileUrl: target.profileUrl, sent, method });
            } catch (err: any) {
                results.push({
                    prospectId: target.prospectId,
                    profileUrl: target.profileUrl,
                    sent: false,
                    method,
                    error: err.message,
                });
            }

            if (results.length < batchToProcess.length) {
                await sleep(jitter(delayMs));
            }
        }

        return results;
    } finally {
        await browser.close();
    }
};
