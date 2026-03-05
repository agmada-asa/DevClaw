/**
 * productDomain.ts
 *
 * CEOClaw product domain — two tasks, both driven by OpenClaw CLI:
 *
 *   1. generate_idea      — brainstorm the next high-leverage feature or
 *                           positioning tweak for DevClaw
 *   2. build_landing_page — generate a complete, deployable HTML landing page
 *                           for DevClaw including copy, CTA, and deployment hint
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runOpenClawPrompt, extractJsonObject } from './openclawRunner';
import { BusinessState, ProductIdeaOutput, LandingPageOutput } from './founderTypes';

// ─── Task 1: Idea Generation ──────────────────────────────────────────────────

const buildIdeaPrompt = (state: BusinessState): string => [
    'You are CEOClaw generating the next product idea for DevClaw.',
    '',
    'DevClaw is a B2B SaaS that automates the dev loop:',
    '  - Developer describes a bug/feature in Telegram',
    '  - DevClaw creates a GitHub issue + architecture plan',
    '  - Human approves → AI agents write the code → GitHub PR opened',
    '',
    `Current state: MRR=$${state.mrr}, signups=${state.totalSignups}, phase=${state.phase}`,
    `Traffic: ${state.trafficLast30d} page views/month`,
    state.latestIdea ? `Previous idea: ${state.latestIdea}` : '',
    '',
    'Generate ONE specific, actionable product idea that would:',
    '- Increase signups or conversion rate, OR',
    '- Reduce churn / increase retention, OR',
    '- Unlock a new customer segment',
    '',
    'Return ONLY valid JSON:',
    '{"idea":"string","rationale":"string","nextSteps":["string"],"estimatedImpact":"string"}',
].join('\n');

const parseIdeaOutput = (raw: string): ProductIdeaOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Idea generator response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        idea: String(parsed.idea || '').trim(),
        rationale: String(parsed.rationale || '').trim(),
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
        estimatedImpact: String(parsed.estimatedImpact || '').trim(),
    };
};

export const generateIdea = async (state: BusinessState): Promise<ProductIdeaOutput> => {
    console.log('[ProductDomain] Generating product idea via OpenClaw...');
    const prompt = buildIdeaPrompt(state);
    const raw = await runOpenClawPrompt(prompt, { timeoutMs: 90_000 });
    const output = parseIdeaOutput(raw);
    console.log(`[ProductDomain] Idea: ${output.idea}`);
    return output;
};

// ─── Task 2: Landing Page Builder ─────────────────────────────────────────────

const buildLandingPagePrompt = (state: BusinessState): string => [
    'You are CEOClaw building a landing page for DevClaw.',
    '',
    'DevClaw is a developer tool (B2B SaaS) that:',
    '  - Lets devs describe bugs/features in Telegram',
    '  - Automatically creates GitHub issues + architecture plans',
    '  - Runs AI Generator + Reviewer agents to write and review code',
    '  - Opens a GitHub PR — all with a human approval gate',
    '',
    'Target customer: startup CTOs, solo founders with small dev teams, dev shop owners.',
    `Current state: MRR=$${state.mrr}, signups=${state.totalSignups}`,
    state.latestIdea ? `Latest product angle: ${state.latestIdea}` : '',
    '',
    'Generate a complete, modern HTML landing page with:',
    '  - A compelling headline + subheadline',
    '  - Clear value proposition section',
    '  - Feature highlights (3 key features)',
    '  - Social proof placeholder',
    '  - Email capture CTA form (connects to /api/signup)',
    '  - Clean CSS inline in <style> tag (no external deps)',
    '  - Mobile responsive',
    '',
    'Return ONLY valid JSON:',
    '{"html":"<full HTML string>","headline":"string","subheadline":"string","ctaText":"string","deployCommand":"vercel deploy --prod"}',
].join('\n');

const parseLandingPageOutput = (raw: string): LandingPageOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Landing page response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        html: String(parsed.html || '').trim(),
        headline: String(parsed.headline || '').trim(),
        subheadline: String(parsed.subheadline || '').trim(),
        ctaText: String(parsed.ctaText || '').trim(),
        deployCommand: typeof parsed.deployCommand === 'string' ? parsed.deployCommand.trim() : undefined,
    };
};

const LANDING_PAGE_DIR = path.resolve(
    process.env.CEOCLAW_OUTPUT_DIR || path.join(process.cwd(), 'ceoclaw-output'),
    'landing-page'
);

export const buildLandingPage = async (state: BusinessState): Promise<LandingPageOutput> => {
    console.log('[ProductDomain] Building landing page via OpenClaw...');
    const prompt = buildLandingPagePrompt(state);
    const raw = await runOpenClawPrompt(prompt, { timeoutMs: 3 * 60_000 });
    const output = parseLandingPageOutput(raw);

    if (output.html) {
        // Write the generated HTML to disk so it can be deployed
        await fs.mkdir(LANDING_PAGE_DIR, { recursive: true });
        const outPath = path.join(LANDING_PAGE_DIR, 'index.html');
        await fs.writeFile(outPath, output.html, 'utf-8');
        console.log(`[ProductDomain] Landing page written to ${outPath}`);
        console.log(`[ProductDomain] To deploy: cd ${LANDING_PAGE_DIR} && ${output.deployCommand || 'vercel deploy --prod'}`);
    }

    console.log(`[ProductDomain] Landing page headline: "${output.headline}"`);
    return output;
};
