/**
 * openclawRunner.ts
 *
 * Shared OpenClaw CLI runner — single source of truth for all OpenClaw
 * gateway/local agent invocations in ceoclaw-founder.
 *
 * Mirrors the pattern in services/openclaw-engine/src/openclawCliPlanner.ts
 * but extracted so every domain module (product, marketing, ops, sales) calls
 * one place instead of duplicating the exec logic.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const parseNumberEnv = (value: string | undefined, fallback: number): number => {
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

// ─── JSON extraction ──────────────────────────────────────────────────────────

export const extractJsonObject = (text: string): string | null => {
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

// ─── Gateway mode ─────────────────────────────────────────────────────────────

const runGatewayAgentPrompt = async (prompt: string, timeoutMs: number): Promise<string> => {
    const cliBin = process.env.OPENCLAW_CLI_BIN || 'openclaw';
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
            console.warn('[OpenClawRunner] CLI stderr:', stderr.trim());
        }
        return extractTextFromCliOutput(stdout);
    } catch (err: any) {
        const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
        const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
        const detail = stderr || stdout || err?.message || 'unknown error';
        throw new Error(`OpenClaw gateway invocation failed: ${detail}`);
    }
};

// ─── Local mode ───────────────────────────────────────────────────────────────

const runLocalAgentPrompt = async (prompt: string, timeoutMs: number): Promise<string> => {
    const cliBin = process.env.OPENCLAW_CLI_BIN || 'openclaw';
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
            console.warn('[OpenClawRunner] Local CLI stderr:', stderr.trim());
        }
        return extractTextFromCliOutput(stdout);
    } catch (err: any) {
        const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
        const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
        const detail = stderr || stdout || err?.message || 'unknown error';
        throw new Error(`OpenClaw local invocation failed: ${detail}`);
    }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a prompt through OpenClaw CLI and return the raw text response.
 * All domain modules (product, marketing, operations, sales) use this.
 *
 * Mode is controlled by OPENCLAW_CLI_MODE env var:
 *   'gateway'      (default) — calls openclaw gateway call agent
 *   'agent-local'            — calls openclaw agent --local
 */
export const runOpenClawPrompt = async (
    prompt: string,
    options?: { timeoutMs?: number }
): Promise<string> => {
    const timeoutMs = options?.timeoutMs
        ?? parseNumberEnv(process.env.OPENCLAW_CLI_TIMEOUT_MS, 2 * 60 * 1000);
    const mode = (process.env.OPENCLAW_CLI_MODE || 'gateway').toLowerCase();
    return mode === 'agent-local'
        ? runLocalAgentPrompt(prompt, timeoutMs)
        : runGatewayAgentPrompt(prompt, timeoutMs);
};
