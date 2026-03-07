/**
 * marketingDomain.ts
 *
 * CEOClaw marketing domain — two tasks via OpenClaw CLI:
 *
 *   1. write_seo_content — generate a full SEO blog post targeting devs/founders
 *                          who would benefit from DevClaw, saved to disk
 *   2. plan_campaign     — generate a LinkedIn/email outreach campaign plan
 *                          with message angles, target audience, and follow-up sequences
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chat } from '@devclaw/llm-router';
import { extractJsonObject } from './openclawRunner';
import { BusinessState, SeoContentOutput, CampaignPlanOutput } from './founderTypes';

const CONTENT_DIR = path.resolve(
    process.env.CEOCLAW_OUTPUT_DIR || path.join(process.cwd(), 'ceoclaw-output'),
    'content'
);

// ─── Task 1: SEO Content Writing ─────────────────────────────────────────────

const SEO_TOPICS = [
    'how AI can automate GitHub pull requests for your dev team',
    'the fastest way to go from bug report to merged PR in 2025',
    'why startup CTOs are using AI code review agents',
    'how to reduce dev bottlenecks with an AI-powered development loop',
    'Telegram bot for developers: automate your issue-to-PR workflow',
    'AI pair programming vs AI code generation: what actually ships faster',
    'from GitHub issue to PR in minutes: the DevClaw workflow explained',
];

const pickSeoTopic = (state: BusinessState): string => {
    // Cycle through topics based on total tasks completed
    const idx = state.tasksCompletedTotal % SEO_TOPICS.length;
    return SEO_TOPICS[idx];
};

const LANDING_PAGE_URL = process.env.CEOCLAW_LANDING_PAGE_URL || 'https://devclaw.ai';

const buildSeoContentPrompt = (state: BusinessState, topic: string): string => [
    'You are CEOClaw, writing SEO content for the DevClaw blog.',
    '',
    'DevClaw is a developer tool that automates the GitHub PR workflow:',
    '  - Dev describes task in Telegram → GitHub issue created',
    '  - AI generates architecture plan → human approves',
    '  - AI Generator + Reviewer agents write code → PR opened',
    '',
    `Topic to write about: "${topic}"`,
    '',
    'Requirements:',
    '  - Target audience: startup CTOs, small dev team leads, indie hackers',
    '  - Length: 800-1200 words',
    '  - Include real, practical value (not fluff)',
    '  - Naturally mention DevClaw as the solution at least twice',
    `  - Include a clear CTA at the end linking to ${LANDING_PAGE_URL}`,
    '  - Output in Markdown format',
    '',
    'Return ONLY valid JSON:',
    '{"title":"string","slug":"string","metaDescription":"string (155 chars max)","markdown":"string","targetKeywords":["string"]}',
].join('\n');

const parseSeoContent = (raw: string): SeoContentOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('SEO content response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        title: String(parsed.title || '').trim(),
        slug: String(parsed.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'),
        metaDescription: String(parsed.metaDescription || '').slice(0, 155).trim(),
        markdown: String(parsed.markdown || '').trim(),
        targetKeywords: Array.isArray(parsed.targetKeywords) ? parsed.targetKeywords.map(String) : [],
    };
};

export const writeSeoContent = async (state: BusinessState): Promise<SeoContentOutput> => {
    const topic = pickSeoTopic(state);
    console.log(`[MarketingDomain] Writing SEO content on: "${topic}"`);
    const prompt = buildSeoContentPrompt(state, topic);
    const response = await chat({
        role: 'planner',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        requestId: `ceoclaw-seo-${Date.now()}`,
    });
    const raw = response.content;
    const output = parseSeoContent(raw);

    // Save to disk
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    const filename = `${output.slug || `post-${Date.now()}`}.md`;
    const outPath = path.join(CONTENT_DIR, filename);
    const frontmatter = [
        '---',
        `title: "${output.title}"`,
        `slug: "${output.slug}"`,
        `description: "${output.metaDescription}"`,
        `keywords: [${output.targetKeywords.map((k) => `"${k}"`).join(', ')}]`,
        `date: "${new Date().toISOString().split('T')[0]}"`,
        '---',
        '',
    ].join('\n');
    await fs.writeFile(outPath, frontmatter + output.markdown, 'utf-8');
    console.log(`[MarketingDomain] SEO post written to ${outPath}: "${output.title}"`);

    return output;
};

// ─── Task 2: Campaign Planning ────────────────────────────────────────────────

const buildCampaignPrompt = (state: BusinessState): string => [
    'You are CEOClaw planning an outreach campaign for DevClaw.',
    '',
    'DevClaw automates GitHub PRs via Telegram + AI agents.',
    'Target customers: startup CTOs, dev shop owners, small team tech leads.',
    `Landing page: ${LANDING_PAGE_URL}`,
    '',
    `Current state: MRR=$${state.mrr}, signups=${state.totalSignups}, traffic=${state.trafficLast30d}/month`,
    state.latestIdea ? `Product angle: ${state.latestIdea}` : '',
    '',
    'Design ONE focused outreach campaign:',
    '  - Define the target audience segment (be specific)',
    '  - Choose channels (LinkedIn + cold email preferred)',
    '  - Write the opening message angle (hook in 1 sentence)',
    '  - Write a subject line for email outreach',
    `  - Write a 3-message follow-up sequence — final message should include a CTA linking to ${LANDING_PAGE_URL}`,
    '  - The goal is to get a demo call or free trial signup',
    '',
    'Return ONLY valid JSON:',
    '{"campaignName":"string","targetAudience":"string","channels":["string"],"messageAngle":"string","emailSubject":"string","emailBody":"string","followUpSequence":["string"]}',
].join('\n');

const parseCampaignPlan = (raw: string): CampaignPlanOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Campaign plan response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        campaignName: String(parsed.campaignName || '').trim(),
        targetAudience: String(parsed.targetAudience || '').trim(),
        channels: Array.isArray(parsed.channels) ? parsed.channels.map(String) : ['LinkedIn'],
        messageAngle: String(parsed.messageAngle || '').trim(),
        emailSubject: String(parsed.emailSubject || '').trim(),
        emailBody: String(parsed.emailBody || '').trim(),
        followUpSequence: Array.isArray(parsed.followUpSequence) ? parsed.followUpSequence.map(String) : [],
    };
};

export const planCampaign = async (state: BusinessState): Promise<CampaignPlanOutput> => {
    console.log('[MarketingDomain] Planning outreach campaign via GLM...');
    const prompt = buildCampaignPrompt(state);
    const response = await chat({
        role: 'orchestrator',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        requestId: `ceoclaw-campaign-${Date.now()}`,
    });
    const raw = response.content;
    const output = parseCampaignPlan(raw);

    // Save campaign plan to disk
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    const outPath = path.join(CONTENT_DIR, `campaign-${Date.now()}.json`);
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`[MarketingDomain] Campaign plan saved to ${outPath}: "${output.campaignName}"`);

    return output;
};
