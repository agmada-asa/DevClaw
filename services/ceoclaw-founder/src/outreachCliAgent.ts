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

import { execFile } from 'child_process';
import { promisify } from 'util';
import { chat } from '@devclaw/llm-router';
import { QualifyInput, QualificationResult, MessageInput, MessageResult } from './types';

const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parseNumberEnv = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolvePlannerRecipient = (): string => {
    const gatewayTo = process.env.OPENCLAW_GATEWAY_TO;
    if (typeof gatewayTo === 'string' && gatewayTo.trim()) return gatewayTo.trim();
    const localTo = process.env.OPENCLAW_LOCAL_TO;
    if (typeof localTo === 'string' && localTo.trim()) return localTo.trim();
    return '+15555550123';
};

const extractJsonObject = (text: string): string | null => {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return text.slice(start, end + 1).trim();
    return null;
};

const collectTextFields = (value: unknown, output: string[]): void => {
    if (typeof value === 'string') return;
    if (Array.isArray(value)) { value.forEach((item) => collectTextFields(item, output)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const text = record.text;
    if (typeof text === 'string' && text.trim()) output.push(text.trim());
    for (const entry of Object.values(record)) collectTextFields(entry, output);
};

const extractTextFromCliOutput = (stdout: string): string => {
    const raw = stdout.trim();
    if (!raw) throw new Error('OpenClaw CLI returned empty stdout');

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        const embedded = extractJsonObject(raw);
        if (!embedded) throw new Error('OpenClaw CLI stdout is not JSON');
        parsed = JSON.parse(embedded);
    }

    const textFields: string[] = [];
    collectTextFields(parsed, textFields);
    if (textFields.length === 0) throw new Error('OpenClaw CLI JSON did not contain any text payload');
    return textFields.join('\n');
};

// ─── OpenClaw CLI invocation ──────────────────────────────────────────────────

const runGatewayAgentPrompt = async (prompt: string): Promise<string> => {
    const cliBin = process.env.OPENCLAW_CLI_BIN || 'openclaw';
    const timeoutMs = parseNumberEnv(process.env.OPENCLAW_CLI_TIMEOUT_MS, 2 * 60 * 1000);
    const params = {
        message: prompt,
        to: resolvePlannerRecipient(),
        timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        idempotencyKey: `ceoclaw-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    };
    const args = [
        'gateway', 'call', 'agent',
        '--json', '--expect-final',
        '--timeout', String(timeoutMs),
        '--params', JSON.stringify(params),
    ];
    if (process.env.OPENCLAW_GATEWAY_URL) args.push('--url', process.env.OPENCLAW_GATEWAY_URL);
    if (process.env.OPENCLAW_GATEWAY_TOKEN) args.push('--token', process.env.OPENCLAW_GATEWAY_TOKEN);

    try {
        const { stdout, stderr } = await execFileAsync(cliBin, args, {
            timeout: timeoutMs + 5000,
            maxBuffer: 8 * 1024 * 1024,
        });
        if (typeof stderr === 'string' && stderr.trim()) {
            console.warn('[CEOClaw] OpenClaw CLI stderr:', stderr.trim());
        }
        return extractTextFromCliOutput(stdout);
    } catch (err: any) {
        const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
        const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
        const detail = stderr || stdout || err?.message || 'unknown OpenClaw error';
        throw new Error(`OpenClaw CLI invocation failed: ${detail}`);
    }
};

const runLocalAgentPrompt = async (prompt: string): Promise<string> => {
    const cliBin = process.env.OPENCLAW_CLI_BIN || 'openclaw';
    const timeoutMs = parseNumberEnv(process.env.OPENCLAW_CLI_TIMEOUT_MS, 2 * 60 * 1000);
    const to = process.env.OPENCLAW_LOCAL_TO || '+15555550123';
    const args = [
        'agent', '--local', '--json',
        '--to', to,
        '--timeout', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        '--message', prompt,
    ];

    try {
        const { stdout, stderr } = await execFileAsync(cliBin, args, {
            timeout: timeoutMs + 10000,
            maxBuffer: 8 * 1024 * 1024,
        });
        if (typeof stderr === 'string' && stderr.trim()) {
            console.warn('[CEOClaw] OpenClaw local stderr:', stderr.trim());
        }
        return extractTextFromCliOutput(stdout);
    } catch (err: any) {
        const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
        const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
        const detail = stderr || stdout || err?.message || 'unknown OpenClaw local error';
        throw new Error(`OpenClaw local invocation failed: ${detail}`);
    }
};

const runOpenClawPrompt = async (prompt: string): Promise<string> => {
    const mode = (process.env.OPENCLAW_CLI_MODE || 'gateway').toLowerCase();
    return mode === 'agent-local'
        ? runLocalAgentPrompt(prompt)
        : runGatewayAgentPrompt(prompt);
};

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
    '',
    'Write a SHORT LinkedIn connection request note:',
    '- Max 300 characters (hard LinkedIn limit)',
    '- Conversational and human, not spammy or salesy',
    '- Reference their specific role or company',
    '- One-line value prop of DevClaw',
    '- Soft CTA: offer a quick demo',
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

export const qualifyProspect = async (input: QualifyInput): Promise<QualificationResult> => {
    const engine = (process.env.CEOCLAW_AGENT_ENGINE || 'openclaw').toLowerCase();
    if (engine === 'direct') {
        console.log(`[CEOClaw] Qualifying prospect ${input.prospectId} via llm-router (direct)`);
        return qualifyProspectDirect(input);
    }

    console.log(`[CEOClaw] Qualifying prospect ${input.prospectId} via OpenClaw CLI`);
    const prompt = buildQualifyPrompt(input);
    const raw = await runOpenClawPrompt(prompt);
    return parseQualificationResult(raw);
};

export const generateOutreachMessage = async (input: MessageInput): Promise<MessageResult> => {
    const engine = (process.env.CEOCLAW_AGENT_ENGINE || 'openclaw').toLowerCase();
    if (engine === 'direct') {
        console.log(`[CEOClaw] Generating message for prospect ${input.prospectId} via llm-router (direct)`);
        return generateMessageDirect(input);
    }

    console.log(`[CEOClaw] Generating message for prospect ${input.prospectId} via OpenClaw CLI`);
    const prompt = buildMessagePrompt(input);
    const raw = await runOpenClawPrompt(prompt);
    return parseMessageResult(raw);
};
