/**
 * outreachCliAgent.ts
 *
 * Mirrors the pattern from services/openclaw-engine/src/openclawCliPlanner.ts.
 * Uses the OpenClaw CLI gateway to:
 *   1. Qualify a LinkedIn prospect (is this person a good fit for DevClaw?)
 *   2. Generate a personalized LinkedIn outreach message
 *
 * Fallback: when CEOCLAW_AGENT_ENGINE=direct, uses @devclaw/llm-router directly.
 */

import { chat } from '@devclaw/llm-router';
import { runOpenClawPrompt, extractJsonObject, parseNumberEnv } from './openclawRunner';
import { QualifyInput, QualificationResult, MessageInput, MessageResult } from './types';

const LANDING_PAGE_URL = process.env.CEOCLAW_LANDING_PAGE_URL || 'https://devclaw.ai';

// ─── Qualification ────────────────────────────────────────────────────────────

const buildQualifyPrompt = (input: QualifyInput): string => [
    'You are CEOClaw, an AI sales qualifier for DevClaw.',
    '',
    'DevClaw is an AI coding assistant that automates the dev loop:',
    '1. Developer describes a bug/feature in Telegram.',
    '2. DevClaw creates a GitHub issue and generates an architecture plan.',
    '3. Human approves the plan.',
    '4. AI Generator + Reviewer agents implement the code and open a GitHub PR.',
    '',
    'A strong prospect is someone at a startup or software dev company who:',
    '- Has a technical or engineering leadership role (CTO, VP Eng, Lead Dev, Founder, etc.)',
    '- Works at a company that ships software products (not pure consulting)',
    '- Could benefit from faster issue-to-PR turnaround',
    '',
    'Return ONLY valid JSON (no markdown, no commentary):',
    '{"qualified":boolean,"fitScore":integer(0-100),"fitReason":"one sentence why they fit or not","decisionReason":"2-3 sentence detailed reasoning"}',
    '',
    `firstName: ${input.firstName}`,
    `lastName: ${input.lastName}`,
    `title: ${input.title}`,
    `company: ${input.companyName}`,
    `industry: ${input.industry || 'unknown'}`,
    `companySize: ${input.companySize || 'unknown'}`,
    `location: ${input.location || 'unknown'}`,
].join('\n');

const parseQualificationResult = (text: string): QualificationResult => {
    const jsonText = extractJsonObject(text);
    if (!jsonText) throw new Error('Qualification response did not contain a JSON object');

    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch {
        throw new Error('Qualification response JSON could not be parsed');
    }

    return {
        qualified: Boolean(parsed.qualified),
        fitScore: typeof parsed.fitScore === 'number' ? Math.max(0, Math.min(100, parsed.fitScore)) : 0,
        fitReason: typeof parsed.fitReason === 'string' ? parsed.fitReason.trim() : '',
        decisionReason: typeof parsed.decisionReason === 'string' ? parsed.decisionReason.trim() : '',
    };
};

// ─── Message Generation ───────────────────────────────────────────────────────

const buildMessagePrompt = (input: MessageInput): string => [
    'You are CEOClaw, writing LinkedIn outreach for DevClaw.',
    '',
    'DevClaw lets developers describe tasks in Telegram and get back a GitHub PR — AI handles planning, coding, and review.',
    `Landing page: ${LANDING_PAGE_URL}`,
    '',
    'Write a SHORT LinkedIn connection request note:',
    '- Max 300 characters (hard LinkedIn limit)',
    '- Conversational and human, not spammy or salesy',
    '- Reference their specific role or company',
    '- One-line value prop of DevClaw',
    `- Soft CTA: invite them to check out ${LANDING_PAGE_URL} or offer a quick demo`,
    '',
    'Return ONLY valid JSON (no markdown):',
    '{"message":"string (≤300 chars)","subject":"string (optional follow-up subject line)"}',
    '',
    `firstName: ${input.firstName}`,
    `lastName: ${input.lastName}`,
    `title: ${input.title}`,
    `company: ${input.companyName}`,
    `industry: ${input.industry || 'tech'}`,
    `companySize: ${input.companySize || 'unknown'}`,
    `fitReason: ${input.fitReason || 'they lead a software team'}`,
].join('\n');

const parseMessageResult = (text: string): MessageResult => {
    const jsonText = extractJsonObject(text);
    if (!jsonText) throw new Error('Message response did not contain a JSON object');

    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch {
        throw new Error('Message response JSON could not be parsed');
    }

    const message = typeof parsed.message === 'string' ? parsed.message.trim().slice(0, 300) : '';
    if (!message) throw new Error('Message response is missing message field');

    return {
        message,
        subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : undefined,
    };
};

// ─── Direct LLM-Router fallback ───────────────────────────────────────────────

const qualifyProspectDirect = async (input: QualifyInput): Promise<QualificationResult> => {
    const response = await chat({
        role: 'prospect_qualifier',
        messages: [
            { role: 'system', content: 'You are a B2B sales qualification expert. Return only valid JSON.' },
            { role: 'user', content: buildQualifyPrompt(input) },
        ],
        temperature: 0.2,
        requestId: input.prospectId,
    });
    return parseQualificationResult(response.content);
};

const generateMessageDirect = async (input: MessageInput): Promise<MessageResult> => {
    const response = await chat({
        role: 'outreach_writer',
        messages: [
            { role: 'system', content: 'You are a B2B SaaS outreach copywriter. Return only valid JSON.' },
            { role: 'user', content: buildMessagePrompt(input) },
        ],
        temperature: 0.7,
        requestId: input.prospectId,
    });
    return parseMessageResult(response.content);
};

// ─── Public API ───────────────────────────────────────────────────────────────

const timeoutMs = parseNumberEnv(process.env.OPENCLAW_CLI_TIMEOUT_MS, 2 * 60 * 1000);

export const qualifyProspect = async (input: QualifyInput): Promise<QualificationResult> => {
    const engine = (process.env.CEOCLAW_AGENT_ENGINE || 'openclaw').toLowerCase();
    if (engine === 'direct') {
        console.log(`[CEOClaw] Qualifying prospect ${input.prospectId} via llm-router (direct)`);
        return qualifyProspectDirect(input);
    }

    console.log(`[CEOClaw] Qualifying prospect ${input.prospectId} via OpenClaw CLI`);
    const raw = await runOpenClawPrompt(buildQualifyPrompt(input), { timeoutMs });
    return parseQualificationResult(raw);
};

export const generateOutreachMessage = async (input: MessageInput): Promise<MessageResult> => {
    const engine = (process.env.CEOCLAW_AGENT_ENGINE || 'openclaw').toLowerCase();
    if (engine === 'direct') {
        console.log(`[CEOClaw] Generating message for prospect ${input.prospectId} via llm-router (direct)`);
        return generateMessageDirect(input);
    }

    console.log(`[CEOClaw] Generating message for prospect ${input.prospectId} via OpenClaw CLI`);
    const raw = await runOpenClawPrompt(buildMessagePrompt(input), { timeoutMs });
    return parseMessageResult(raw);
};
