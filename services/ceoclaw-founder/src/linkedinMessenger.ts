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
        await sleep(jitter(2000));

        // Inspect what action buttons are available on this profile (fast DOM query)
        const pageButtons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button'))
                .slice(0, 20)
                .map(b => ({ text: (b.textContent || '').trim(), aria: b.getAttribute('aria-label') || '' }));
        });

        // Check if this profile only has "Follow" (no Connect available — influencer/creator)
        const mainButtons = pageButtons.slice(5, 12); // profile action buttons start ~index 6
        const hasFollow = mainButtons.some(b => b.aria.startsWith('Follow '));
        const hasConnect = mainButtons.some(b => b.aria.includes('Invite') && b.aria.includes('connect'));
        if (hasFollow && !hasConnect) {
            console.warn(`[LinkedInMessenger] ${profileUrl} only has Follow button — skipping (influencer/creator profile)`);
            return false;
        }

        let connected = false;

        // 1. Try name-specific selector first: "Invite [FirstName] to connect" — most reliable
        if (firstName) {
            const nameBtn = page.locator(`button[aria-label*="Invite ${firstName}"]`).first();
            const visible = await nameBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (visible) {
                await nameBtn.click();
                await sleep(jitter(1000));
                connected = true;
            }
        }

        // 2. Any "Invite … to connect" button (avoids matching sidebar Follow buttons)
        if (!connected) {
            const inviteBtn = page.locator('button[aria-label*="Invite"][aria-label*="connect"]').first();
            const visible = await inviteBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (visible) {
                await inviteBtn.click();
                await sleep(jitter(1000));
                connected = true;
            }
        }

        // 3. Connect may be behind a "More actions" dropdown
        if (!connected) {
            const moreBtn = page.locator('button[aria-label*="More actions"], button[aria-label*="more actions"]').first();
            const moreVisible = await moreBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (moreVisible) {
                await moreBtn.click();
                await sleep(jitter(800));
                const connectOption = page.locator('[role="menuitem"]:has-text("Connect")').first();
                const optionVisible = await connectOption.isVisible({ timeout: 3000 }).catch(() => false);
                if (optionVisible) {
                    await connectOption.click();
                    await sleep(jitter(800));
                    connected = true;
                }
            }
        }

        if (!connected) {
            console.warn(`[LinkedInMessenger] Connect button not found on ${profileUrl}`);
            return false;
        }

        // Add a note to the connection request
        const addNoteBtn = page.locator('button:has-text("Add a note"), button[aria-label*="Add a note"]').first();
        const addNoteVisible = await addNoteBtn.isVisible({ timeout: 5000 }).catch(() => false);

        if (addNoteVisible) {
            await addNoteBtn.click();
            await sleep(jitter(800));

            const noteArea = page.locator('textarea[name="message"], #custom-message').first();
            await noteArea.fill(truncatedNote);
            await sleep(jitter(500));
        }

        // Submit the connection request
        const sendBtn = page.locator(
            'button[aria-label*="Send invitation"], button:has-text("Send invitation"), button:has-text("Send")'
        ).last();
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
        await sleep(jitter(2000));

        const messageBtn = page.locator(
            'button[aria-label*="Message"], button:has-text("Message")'
        ).first();
        const visible = await messageBtn.isVisible({ timeout: 5000 }).catch(() => false);

        if (!visible) {
            console.warn(`[LinkedInMessenger] Message button not found on ${profileUrl}`);
            return false;
        }

        await messageBtn.click();
        await sleep(jitter(1500));

        // Type the message in the chat compose area
        const composeArea = page.locator(
            '.msg-form__contenteditable, div[role="textbox"][aria-label*="Write a message"]'
        ).first();
        await composeArea.fill(message);
        await sleep(jitter(500));

        // Send
        const sendBtn = page.locator(
            'button.msg-form__send-button, button[aria-label*="Send message"]'
        ).first();
        await sendBtn.click();
        await sleep(jitter(1500));

        console.log(`[LinkedInMessenger] Direct message sent to ${profileUrl}`);
        return true;
    } catch (err: any) {
        console.error(`[LinkedInMessenger] Failed to message ${profileUrl}:`, err.message);
        return false;
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

export const sendOutreachBatch = async (
    targets: OutreachTarget[]
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
        console.log(
            `[LinkedInMessenger] Processing ${batchToProcess.length} outreach targets ` +
            `(daily limit: ${dailyLimit})`
        );

        for (const target of batchToProcess) {
            const is1st = target.connectionDegree === '1st';
            let sent = false;
            let method: OutreachResult['method'] = 'skipped';

            try {
                if (is1st) {
                    sent = await sendDirectMessage(page, target.profileUrl, target.message);
                    method = 'direct_message';
                } else {
                    sent = await sendConnectionRequest(page, target.profileUrl, target.message, target.firstName);
                    method = 'connection_request';
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

            await sleep(jitter(delayMs));
        }

        return results;
    } finally {
        await browser.close();
    }
};
