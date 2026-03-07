import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    AgentPairFactoryRegistry,
    ReviewerDecision,
    WorkspaceFileSnapshot,
} from './agentFactories';
import {
    AgentLoopIterationResult,
    AgentLoopReport,
    SubTaskLoopResult,
} from './agentLoopManager';
import {
    ApprovedPatchSet,
    ApprovedPatchSubTask,
    BranchPushResult,
    ExecutePayload,
    ExecutionSubTask,
} from './executionPlugin';

const execFileAsync = promisify(execFile);

interface CommandResult {
    stdout: string;
    stderr: string;
}

type GitExecutor = (args: string[], cwd: string) => Promise<CommandResult>;

interface ApprovedSubTaskResult {
    report: SubTaskLoopResult;
    patch: string;
    commitSha: string;
    filesChanged: string[];
    generatorName: string;
    reviewerName: string;
}

export interface ExecutionStageResult {
    agentLoopReport: AgentLoopReport;
    approvedPatchSet?: ApprovedPatchSet;
    branchPush?: BranchPushResult;
}

interface GeneratedFileRewrite {
    path: string;
    content: string;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveMaxIterations = (): number =>
    parsePositiveInt(process.env.RUNNER_AGENT_LOOP_MAX_ITERATIONS, 1);

const resolveFileSnapshotMaxChars = (): number =>
    parsePositiveInt(process.env.RUNNER_AGENT_FILE_CONTEXT_MAX_CHARS, 8_000);

const resolveFileSnapshotMaxFiles = (): number =>
    parsePositiveInt(process.env.RUNNER_AGENT_FILE_CONTEXT_MAX_FILES, 10);

const resolveGitTimeoutMs = (): number =>
    parsePositiveInt(process.env.RUNNER_GIT_TIMEOUT_MS, 10 * 60 * 1000);

const isGitPushEnabled = (): boolean => {
    const value = process.env.RUNNER_GIT_PUSH_ENABLED;
    if (typeof value !== 'string') {
        return true;
    }
    return value.trim().toLowerCase() !== 'false';
};

const sanitizeCommitToken = (value: string): string =>
    value
        .replace(/[^a-zA-Z0-9._-]+/g, ' ')
        .trim()
        .slice(0, 80) || 'execution-subtask';

const runGitCli: GitExecutor = async (
    args: string[],
    cwd: string
): Promise<CommandResult> => {
    try {
        const result = await execFileAsync('git', args, {
            cwd,
            timeout: resolveGitTimeoutMs(),
            maxBuffer: 10 * 1024 * 1024,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',
            },
        });
        return {
            stdout: (result.stdout || '').toString(),
            stderr: (result.stderr || '').toString(),
        };
    } catch (err: any) {
        const stderr = (err?.stderr || '').toString().trim();
        const stdout = (err?.stdout || '').toString().trim();
        const detail = stderr || stdout || err?.message || 'unknown git error';
        throw new Error(`Git command failed (git ${args.join(' ')}): ${detail}`);
    }
};

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const extractBalancedJsonObjects = (text: string): string[] => {
    const candidates: string[] = [];
    let inString = false;
    let isEscaped = false;
    let depth = 0;
    let objectStart = -1;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (ch === '\\') {
                isEscaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            if (depth === 0) {
                objectStart = i;
            }
            depth += 1;
            continue;
        }

        if (ch === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && objectStart >= 0) {
                candidates.push(text.slice(objectStart, i + 1).trim());
                objectStart = -1;
            }
        }
    }

    return candidates;
};

const extractJsonObject = (text: string): string | null => {
    const rawText = text.trim();
    if (!rawText) {
        return null;
    }

    const sources: string[] = [];
    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fencedMatch: RegExpExecArray | null;

    while ((fencedMatch = fencedRegex.exec(rawText)) !== null) {
        if (fencedMatch[1]?.trim()) {
            sources.push(fencedMatch[1].trim());
        }
    }

    // Also scan the full raw text to tolerate outputs that include extra prose/noise.
    sources.push(rawText);

    let fallback: string | null = null;
    for (const source of sources) {
        const candidates = extractBalancedJsonObjects(source);
        for (const candidate of candidates) {
            fallback = fallback || candidate;
            if (parseLooseJsonObject(candidate)) {
                return candidate;
            }
        }
    }

    return fallback;
};

const isPlaceholderValue = (value: string | undefined): boolean => {
    if (!value) {
        return true;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 ||
        normalized === 'unknown' ||
        normalized === 'n/a' ||
        normalized === 'none' ||
        normalized === 'null' ||
        normalized === 'undefined';
};

const extractFromFence = (value: string): string => {
    const fenceMatch = value.match(/^```(?:diff|patch)?\s*([\s\S]*?)```$/i);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }
    return value;
};

const extractPatchFieldString = (text: string): string => {
    const keyPattern = /"patch"\s*:\s*/g;
    let keyMatch: RegExpExecArray | null = null;

    while ((keyMatch = keyPattern.exec(text)) !== null) {
        let index = keyMatch.index + keyMatch[0].length;
        while (index < text.length && /\s/.test(text[index])) {
            index += 1;
        }
        if (text[index] !== '"') {
            continue;
        }

        const start = index;
        index += 1;
        let escaped = false;
        while (index < text.length) {
            const char = text[index];
            if (escaped) {
                escaped = false;
                index += 1;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                index += 1;
                continue;
            }
            if (char === '"') {
                const literal = text.slice(start, index + 1);
                try {
                    const decoded = JSON.parse(literal) as unknown;
                    if (typeof decoded === 'string') {
                        return decoded;
                    }
                } catch {
                    // Continue searching for the next patch field.
                }
                break;
            }
            index += 1;
        }
    }

    return '';
};

const extractFencedBodies = (text: string): string[] => {
    const bodies: string[] = [];
    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = fencedRegex.exec(text)) !== null) {
        if (match[1]?.trim()) {
            bodies.push(match[1].trim());
        }
    }

    return bodies;
};

const escapeJsonControlCharsInStrings = (value: string): string => {
    let inString = false;
    let escaped = false;
    let output = '';

    for (let i = 0; i < value.length; i += 1) {
        const ch = value[i];

        if (inString) {
            if (escaped) {
                output += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\') {
                output += ch;
                escaped = true;
                continue;
            }

            if (ch === '"') {
                output += ch;
                inString = false;
                continue;
            }

            if (ch === '\n') {
                output += '\\n';
                continue;
            }

            if (ch === '\r') {
                output += '\\r';
                continue;
            }

            if (ch === '\t') {
                output += '\\t';
                continue;
            }

            output += ch;
            continue;
        }

        output += ch;
        if (ch === '"') {
            inString = true;
        }
    }

    return output;
};

const parseLooseJsonObject = (text: string): Record<string, unknown> | null => {
    const candidate = text.trim();
    if (!candidate) {
        return null;
    }

    const attempts = [
        candidate,
        candidate.replace(/,\s*([}\]])/g, '$1'),
        escapeJsonControlCharsInStrings(candidate),
        escapeJsonControlCharsInStrings(candidate).replace(/,\s*([}\]])/g, '$1'),
    ];

    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Try next candidate.
        }
    }

    return null;
};

const decodeLooseFileContent = (value: string): string =>
    value
        .replace(/\r\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .replace(/\\\\/g, '\\');

const findLooseContentTerminatorOffset = (text: string): number => {
    const patterns = [
        /"\s*}\s*,\s*{/,
        /"\s*}\s*]\s*,\s*"/,
        /"\s*}\s*]\s*}/,
    ];

    let earliest = -1;
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (!match) {
            continue;
        }
        if (earliest === -1 || match.index < earliest) {
            earliest = match.index;
        }
    }

    return earliest;
};

const extractLooseJsonFileRewrites = (content: string): GeneratedFileRewrite[] => {
    const sources = [...extractFencedBodies(content), content];
    const rewrites: GeneratedFileRewrite[] = [];

    for (const source of sources) {
        let cursor = 0;

        while (cursor < source.length) {
            const pathMatch = /"path"\s*:\s*"([^"\n]+)"/g.exec(source.slice(cursor));
            if (!pathMatch || typeof pathMatch.index !== 'number') {
                break;
            }

            const path = pathMatch[1]?.trim();
            const absolutePathMatchIndex = cursor + pathMatch.index;
            const afterPathIndex = absolutePathMatchIndex + pathMatch[0].length;
            const contentMatch = /"content"\s*:\s*"/g.exec(source.slice(afterPathIndex));

            if (!path || !contentMatch || typeof contentMatch.index !== 'number') {
                cursor = afterPathIndex;
                continue;
            }

            const contentStart = afterPathIndex + contentMatch.index + contentMatch[0].length;
            const remaining = source.slice(contentStart);
            const terminatorOffset = findLooseContentTerminatorOffset(remaining);

            if (terminatorOffset === -1) {
                cursor = contentStart;
                continue;
            }

            rewrites.push({
                path,
                content: decodeLooseFileContent(remaining.slice(0, terminatorOffset)),
            });

            cursor = contentStart + terminatorOffset + 1;
        }

        if (rewrites.length > 0) {
            return rewrites.slice(0, 50);
        }
    }

    return [];
};

const toGeneratedFileRewrites = (value: unknown): GeneratedFileRewrite[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const candidate = entry as Record<string, unknown>;
            const filePath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
            const content = typeof candidate.content === 'string' ? candidate.content : '';
            if (!filePath) {
                return null;
            }
            return { path: filePath, content };
        })
        .filter((entry): entry is GeneratedFileRewrite => Boolean(entry))
        .slice(0, 50);
};

const extractFileRewritesFromContent = (content: string): GeneratedFileRewrite[] => {
    const textRewrites: GeneratedFileRewrite[] = [];
    const fileRegex = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/g;
    let match;
    while ((match = fileRegex.exec(content)) !== null) {
        const path = match[1].trim();
        if (path) {
            textRewrites.push({ path, content: match[2].trim() });
        }
    }
    if (textRewrites.length > 0) {
        return textRewrites;
    }

    const mdRegex = /```[\w-]*:([^\n`]+)\n([\s\S]*?)```/g;
    while ((match = mdRegex.exec(content)) !== null) {
        const path = match[1].trim();
        if (path) {
            textRewrites.push({ path, content: match[2].trim() });
        }
    }
    if (textRewrites.length > 0) {
        return textRewrites;
    }

    const jsonObject = extractJsonObject(content);
    const candidates = [jsonObject, ...extractFencedBodies(content), content]
        .filter((entry): entry is string => Boolean(entry))
        .map((entry) => entry.trim());

    for (const candidate of candidates) {
        const parsed = parseLooseJsonObject(candidate);
        if (!parsed) {
            continue;
        }

        const rewrites = toGeneratedFileRewrites(parsed.files);
        if (rewrites.length > 0) {
            return rewrites;
        }
        const altRewrites = toGeneratedFileRewrites(parsed.writeFiles);
        if (altRewrites.length > 0) {
            return altRewrites;
        }
    }

    const looseRewrites = extractLooseJsonFileRewrites(content);
    if (looseRewrites.length > 0) {
        return looseRewrites;
    }

    return [];
};

const isPatchLike = (value: string): boolean =>
    value.includes('diff --git') ||
    (value.startsWith('--- ') && value.includes('\n+++ '));

const normalizePatch = (value: string): string => {
    let normalized = value.trim();
    if (!normalized.includes('\n') && normalized.includes('\\n')) {
        normalized = normalized
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t');
    }

    if (!normalized.includes('\n') && normalized.startsWith('"') && normalized.endsWith('"')) {
        try {
            const decoded = JSON.parse(normalized) as unknown;
            if (typeof decoded === 'string') {
                normalized = decoded;
            }
        } catch {
            // Keep original normalized value.
        }
    }

    normalized = normalized.replace(/\r\n/g, '\n').trim();
    normalized = extractFromFence(normalized);

    const diffStart = normalized.indexOf('diff --git');
    if (diffStart >= 0) {
        normalized = normalized.slice(diffStart).trim();
    } else if (!normalized.startsWith('--- ')) {
        const altStart = normalized.indexOf('\n--- ');
        if (altStart >= 0) {
            normalized = normalized.slice(altStart + 1).trim();
        }
    }

    return normalized;
};

const extractPatchFromContent = (content: string): string => {
    const jsonCandidate = extractJsonObject(content);
    if (jsonCandidate) {
        try {
            const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
            if (typeof parsed.patch === 'string' && parsed.patch.trim()) {
                const normalizedPatch = normalizePatch(parsed.patch);
                return isPatchLike(normalizedPatch) ? normalizedPatch : '';
            }
        } catch {
            const fallbackPatch = extractPatchFieldString(jsonCandidate);
            if (fallbackPatch) {
                const normalizedPatch = normalizePatch(fallbackPatch);
                if (isPatchLike(normalizedPatch)) {
                    return normalizedPatch;
                }
            }
        }
    }

    const fallbackPatchFromContent = extractPatchFieldString(content);
    if (fallbackPatchFromContent) {
        const normalizedPatch = normalizePatch(fallbackPatchFromContent);
        if (isPatchLike(normalizedPatch)) {
            return normalizedPatch;
        }
    }

    const diffFence = content.match(/```(?:diff|patch)\s*([\s\S]*?)```/i);
    if (diffFence?.[1]) {
        const candidate = normalizePatch(diffFence[1]);
        if (isPatchLike(candidate)) {
            return candidate;
        }
    }

    const diffStart = content.indexOf('diff --git');
    if (diffStart >= 0) {
        return normalizePatch(content.slice(diffStart));
    }

    if (content.trim().startsWith('--- ') && content.includes('\n+++ ')) {
        return normalizePatch(content);
    }

    return '';
};

const formatLoopError = (err: unknown): string => {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
};

const asNonEmptyStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 20);
};

const joinScopedArgs = (baseArgs: string[], files: string[]): string[] => {
    const scopedFiles = files
        .map((entry) => entry.trim())
        .filter(Boolean);

    if (scopedFiles.length === 0) {
        return baseArgs;
    }

    return [...baseArgs, '--', ...scopedFiles];
};

export class ExecutionStageManager {
    constructor(
        private readonly registry: AgentPairFactoryRegistry = new AgentPairFactoryRegistry(),
        private readonly runGit: GitExecutor = runGitCli,
        private readonly maxIterations: number = resolveMaxIterations(),
        private readonly fileSnapshotMaxChars: number = resolveFileSnapshotMaxChars(),
        private readonly fileSnapshotMaxFiles: number = resolveFileSnapshotMaxFiles(),
        private readonly gitPushEnabled: boolean = isGitPushEnabled()
    ) { }

    async run(payload: ExecutePayload): Promise<ExecutionStageResult | null> {
        const subTasks = payload.executionSubTasks || [];
        if (subTasks.length === 0) {
            return null;
        }

        if (!payload.isolatedEnvironmentPath) {
            throw new Error('Execution stage requires isolatedEnvironmentPath from orchestrator.');
        }

        const workspacePath = path.resolve(payload.isolatedEnvironmentPath);
        await access(workspacePath, fsConstants.F_OK | fsConstants.R_OK | fsConstants.W_OK);

        await this.ensureGitIdentity(workspacePath);
        const branchName = await this.ensureExecutionBranch(
            workspacePath,
            payload.executionBranchName,
            payload.runId
        );
        const baseCommit = await this.resolveBaseCommit(workspacePath);

        console.log(
            `[AgentRunner][ExecutionStage] Starting runId=${payload.runId} branch=${branchName} ` +
            `workspace=${workspacePath} subTasks=${subTasks.length}`
        );

        let repoFileTree: string[] | undefined;
        try {
            const image = process.env.RUNNER_DOCKER_IMAGE || 'node:22-bookworm-slim';
            const result = await execFileAsync('docker', [
                'run', '--rm',
                '-v', `${workspacePath}:/workspace`,
                '--workdir', '/workspace',
                image,
                'sh', '-c', 'find . -type f -not -path "*/.git/*" -not -path "*/node_modules/*" | sed "s|^./||"'
            ], { timeout: 30000 });
            repoFileTree = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
            console.log(`[AgentRunner][ExecutionStage] Extracted ${repoFileTree.length} files from docker workspace environment`);
        } catch (err: any) {
            console.warn(`[AgentRunner][ExecutionStage] Failed to extract repo file tree via Docker: ${err.message}`);
            repoFileTree = [];
        }

        const loopResults: SubTaskLoopResult[] = [];
        const approvedSubTasks: ApprovedPatchSubTask[] = [];

        for (const subTask of subTasks) {
            const approvedSubTask = await this.runSubTaskLoop(
                payload,
                subTask,
                workspacePath,
                branchName,
                repoFileTree
            );
            loopResults.push(approvedSubTask.report);
            approvedSubTasks.push({
                subTaskId: subTask.id,
                domain: subTask.domain,
                agent: subTask.agent,
                generator: approvedSubTask.generatorName,
                reviewer: approvedSubTask.reviewerName,
                iterations: approvedSubTask.report.iterations,
                reviewerNotes: approvedSubTask.report.reviewerNotes,
                filesChanged: approvedSubTask.filesChanged,
                commitSha: approvedSubTask.commitSha,
                patch: approvedSubTask.patch,
            });
        }

        const approvedCount = loopResults.filter((result) => result.finalDecision === 'APPROVED').length;
        const agentLoopReport: AgentLoopReport = {
            maxIterations: this.maxIterations,
            totalSubTasks: loopResults.length,
            approvedSubTasks: approvedCount,
            rewriteRequiredSubTasks: loopResults.length - approvedCount,
            subTasks: loopResults,
        };

        if (approvedCount === 0) {
            console.warn(
                `[AgentRunner][ExecutionStage] No subTasks were approved for runId=${payload.runId}; ` +
                'skipping branch push and approved patch set publication'
            );

            return {
                agentLoopReport,
            };
        }

        const headCommit = await this.resolveHeadCommit(workspacePath);
        const patch = (await this.runGit(['diff', `${baseCommit}..${headCommit}`], workspacePath)).stdout;
        const patchSetRef = `${payload.runId}:${headCommit.slice(0, 12)}`;

        const branchPush = await this.pushExecutionBranch(workspacePath, branchName, headCommit);
        const approvedPatchSet: ApprovedPatchSet = {
            patchSetRef,
            runId: payload.runId,
            planId: payload.planId,
            branchName,
            baseCommit,
            headCommit,
            createdAt: new Date().toISOString(),
            subTasks: approvedSubTasks,
            patch,
        };

        console.log(
            `[AgentRunner][ExecutionStage] Completed runId=${payload.runId} ` +
            `approvedSubTasks=${approvedCount}/${loopResults.length} head=${headCommit}`
        );

        return {
            agentLoopReport,
            approvedPatchSet,
            branchPush,
        };
    }

    private async runSubTaskLoop(
        payload: ExecutePayload,
        subTask: ExecutionSubTask,
        workspacePath: string,
        branchName: string,
        repoFileTree?: string[]
    ): Promise<ApprovedSubTaskResult> {
        const pair = this.registry.createPair(subTask.domain);
        const trace: AgentLoopIterationResult[] = [];
        let reviewerNotes: string[] = [];
        let finalDecision: ReviewerDecision = 'REWRITE';

        console.log(
            `[AgentRunner][ExecutionStage] Routing subTask=${subTask.id} ` +
            `domain=${subTask.domain} -> generator=${pair.generator.name}, reviewer=${pair.reviewer.name}`
        );

        for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
            console.log(
                `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} generation started`
            );
            const snapshots = await this.collectFileSnapshots(workspacePath, subTask.files);
            const generation = await pair.generator.run({
                runId: payload.runId,
                requestId: payload.requestId,
                planId: payload.planId,
                iteration,
                subTask,
                reviewerNotes,
                workspacePath,
                executionBranchName: branchName,
                fileSnapshots: snapshots,
                repoFileTree,
            });

            const generatedRewrites = extractFileRewritesFromContent(generation.content);
            const proposedPatch = extractPatchFromContent(generation.content);
            const allowPatchFallback = subTask.domain !== 'backend';
            // Backend generator must return full file rewrites; patch fallback remains frontend-only.
            const applyMode = generatedRewrites.length > 0
                ? 'rewrite-files'
                : allowPatchFallback && proposedPatch
                    ? 'patch'
                    : 'none';

            console.log(
                `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                `generator output (${generation.content.length} chars)`
            );

            if (applyMode === 'none') {
                const missingChangeSetNote =
                    'Generator response did not include valid file rewrites.';
                reviewerNotes = [
                    missingChangeSetNote,
                    'Provide a JSON summary and output full file rewrites inside the files[] array. Do not use file diffs or patches.',
                ];
                finalDecision = 'REWRITE';
                trace.push(this.syntheticRewriteTrace(
                    iteration,
                    pair.generator.name,
                    pair.reviewer.name,
                    generation.model,
                    generation.provider,
                    missingChangeSetNote
                ));

                console.warn(
                    `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                    `generator parse failed; generatorOutputPreview=${JSON.stringify(generation.content.slice(0, 220))}`
                );
                continue;
            }

            try {
                if (applyMode === 'patch' && proposedPatch) {
                    await this.applyPatch(workspacePath, proposedPatch);
                    console.log(
                        `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                        `applied patch fallback`
                    );
                } else {
                    await this.applyFileRewrites(workspacePath, generatedRewrites);
                    console.log(
                        `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                        `applied rewrite-files count=${generatedRewrites.length}`
                    );
                }
            } catch (err) {
                await this.discardWorkingChanges(workspacePath);
                const applyNote = `Change application failed: ${formatLoopError(err)}`;
                reviewerNotes = [
                    applyNote,
                    'Regenerate file blocks with complete file contents and valid relative paths. Do not use file diffs or patches, just an entire rewrite.',
                ];
                finalDecision = 'REWRITE';
                trace.push(this.syntheticRewriteTrace(
                    iteration,
                    pair.generator.name,
                    pair.reviewer.name,
                    generation.model,
                    generation.provider,
                    applyNote
                ));
                const preview = JSON.stringify(generatedRewrites);
                console.warn(
                    `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                    `apply failed: ${applyNote}; applyMode=${applyMode}; preview=${JSON.stringify(preview.slice(0, 220))}`
                );
                continue;
            }

            const workspaceDiff = subTask.domain === 'backend'
                ? ''
                : await this.readStagedDiff(workspacePath, subTask.files);
            if (subTask.domain !== 'backend' && !workspaceDiff) {
                reviewerNotes = [
                    'Generator changes applied but produced no staged diff.',
                    'Ensure rewritten files actually modify repository contents.',
                ];
                finalDecision = 'REWRITE';
                await this.discardWorkingChanges(workspacePath);
                continue;
            }

            const review = await pair.reviewer.run({
                runId: payload.runId,
                requestId: payload.requestId,
                planId: payload.planId,
                iteration,
                subTask,
                generation,
                workspacePath,
                executionBranchName: branchName,
                proposedPatch: subTask.domain === 'backend' ? undefined : workspaceDiff,
                workspaceDiff: subTask.domain === 'backend' ? undefined : workspaceDiff,
                fileSnapshots: snapshots,
                repoFileTree,
            });

            finalDecision = review.decision;
            reviewerNotes = review.notes;

            trace.push({
                iteration,
                generator: {
                    name: pair.generator.name,
                    model: generation.model,
                    provider: generation.provider,
                },
                reviewer: {
                    name: pair.reviewer.name,
                    model: review.model,
                    provider: review.provider,
                    decision: review.decision,
                    notes: review.notes,
                },
            });

            console.log(
                `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                `review decision=${review.decision}`
            );

            if (review.decision === 'APPROVED') {
                const stagedFiles = await this.listStagedFiles(workspacePath);
                if (stagedFiles.length === 0) {
                    if (subTask.domain === 'backend') {
                        console.log(
                            `[AgentRunner][ExecutionStage] subTask=${subTask.id} iteration=${iteration} ` +
                            'reviewer approved with no staged changes; returning approved result without commit'
                        );
                        return {
                            report: {
                                subTaskId: subTask.id,
                                domain: subTask.domain,
                                agent: subTask.agent,
                                iterations: trace.length,
                                finalDecision,
                                reviewerNotes,
                                trace,
                            },
                            patch: '',
                            commitSha: '',
                            filesChanged: [],
                            generatorName: pair.generator.name,
                            reviewerName: pair.reviewer.name,
                        };
                    }

                    reviewerNotes = ['Reviewer approved but no staged changes were detected.'];
                    finalDecision = 'REWRITE';
                    await this.discardWorkingChanges(workspacePath);
                    continue;
                }

                const commitSha = await this.commitSubTask(workspacePath, subTask, iteration);
                const patch = (await this.runGit(
                    ['show', '--format=', '--patch', commitSha],
                    workspacePath
                )).stdout;
                const filesChanged = asNonEmptyStringArray((await this.runGit(
                    ['show', '--format=', '--name-only', commitSha],
                    workspacePath
                )).stdout.split('\n'));

                console.log(
                    `[AgentRunner][ExecutionStage] subTask=${subTask.id} approved and committed sha=${commitSha}`
                );

                return {
                    report: {
                        subTaskId: subTask.id,
                        domain: subTask.domain,
                        agent: subTask.agent,
                        iterations: trace.length,
                        finalDecision,
                        reviewerNotes,
                        trace,
                    },
                    patch,
                    commitSha,
                    filesChanged,
                    generatorName: pair.generator.name,
                    reviewerName: pair.reviewer.name,
                };
            }

            await this.discardWorkingChanges(workspacePath);
        }

        // After max iterations without approval, return a result indicating REWRITE decision
        const resultReport = {
            subTaskId: subTask.id,
            domain: subTask.domain,
            agent: subTask.agent,
            iterations: trace.length,
            finalDecision: 'REWRITE' as const,
            reviewerNotes,
            trace,
        };
        // No changes were committed, so patch and commitSha are empty
        return {
            report: resultReport,
            patch: '',
            commitSha: '',
            filesChanged: [],
            generatorName: pair.generator.name,
            reviewerName: pair.reviewer.name,
        };
    }

    private syntheticRewriteTrace(
        iteration: number,
        generatorName: string,
        reviewerName: string,
        model: string,
        provider: string,
        note: string
    ): AgentLoopIterationResult {
        return {
            iteration,
            generator: {
                name: generatorName,
                model,
                provider,
            },
            reviewer: {
                name: reviewerName,
                model: 'system',
                provider: 'system',
                decision: 'REWRITE',
                notes: [note],
            },
        };
    }

    private async collectFileSnapshots(
        workspacePath: string,
        files: string[]
    ): Promise<WorkspaceFileSnapshot[]> {
        const snapshots: WorkspaceFileSnapshot[] = [];
        for (const rawFilePath of files.slice(0, this.fileSnapshotMaxFiles)) {
            const filePath = rawFilePath.trim();
            if (!filePath) {
                continue;
            }
            const resolved = this.resolveWorkspacePath(workspacePath, filePath);
            try {
                const content = await readFile(resolved, 'utf8');
                const truncated = content.length > this.fileSnapshotMaxChars;
                snapshots.push({
                    path: filePath,
                    exists: true,
                    content: truncated ? `${content.slice(0, this.fileSnapshotMaxChars)}\n...(truncated)` : content,
                    truncated,
                });
            } catch (err: any) {
                if (err?.code === 'ENOENT') {
                    snapshots.push({
                        path: filePath,
                        exists: false,
                        content: '',
                        truncated: false,
                    });
                    continue;
                }
                throw new Error(`Failed to read file snapshot "${filePath}": ${formatLoopError(err)}`);
            }
        }
        return snapshots;
    }

    private resolveWorkspacePath(workspacePath: string, filePath: string): string {
        const normalized = filePath.replace(/^\/+/, '');
        const resolved = path.resolve(workspacePath, normalized);
        const relative = path.relative(workspacePath, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`File path "${filePath}" escapes isolated workspace.`);
        }
        return resolved;
    }

    private async applyPatch(workspacePath: string, patchContent: string): Promise<void> {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-runner-patch-'));
        const patchPath = path.join(tempDir, 'change.patch');
        const normalizedPatch = patchContent.endsWith('\n') ? patchContent : `${patchContent}\n`;
        await writeFile(patchPath, normalizedPatch, 'utf8');

        try {
            try {
                await this.runGit(['apply', '--index', patchPath], workspacePath);
            } catch {
                try {
                    await this.runGit(['apply', '--index', '--3way', patchPath], workspacePath);
                } catch {
                    await this.runGit(['apply', '--index', '--recount', '--unidiff-zero', patchPath], workspacePath);
                }
            }
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    private async applyFileRewrites(
        workspacePath: string,
        rewrites: GeneratedFileRewrite[]
    ): Promise<void> {
        const stagedPaths: string[] = [];
        for (const rewrite of rewrites) {
            const safePath = rewrite.path.trim();
            if (!safePath) {
                continue;
            }
            const resolved = this.resolveWorkspacePath(workspacePath, safePath);
            await mkdir(path.dirname(resolved), { recursive: true });
            await writeFile(resolved, rewrite.content, 'utf8');
            stagedPaths.push(safePath);
        }

        if (stagedPaths.length === 0) {
            throw new Error('No valid file rewrite entries were provided by generator.');
        }

        await this.runGit(joinScopedArgs(['add', '-A'], stagedPaths), workspacePath);
    }

    private async readStagedDiff(workspacePath: string, files: string[]): Promise<string> {
        const result = await this.runGit(joinScopedArgs(['diff', '--cached'], files), workspacePath);
        return result.stdout.trim();
    }

    private async listStagedFiles(workspacePath: string): Promise<string[]> {
        const result = await this.runGit(['diff', '--cached', '--name-only'], workspacePath);
        return asNonEmptyStringArray(result.stdout.split('\n'));
    }

    private async commitSubTask(
        workspacePath: string,
        subTask: ExecutionSubTask,
        iteration: number
    ): Promise<string> {
        const message = [
            `feat(agent-runner): apply ${subTask.domain} patch`,
            '',
            `subTask: ${subTask.id}`,
            `iteration: ${iteration}`,
            `objective: ${sanitizeCommitToken(subTask.objective)}`,
        ].join('\n');
        await this.runGit(['commit', '-m', message], workspacePath);
        return this.resolveHeadCommit(workspacePath);
    }

    private async resolveHeadCommit(workspacePath: string): Promise<string> {
        const head = await this.runGit(['rev-parse', 'HEAD'], workspacePath);
        const sha = head.stdout.trim();
        if (!sha) {
            throw new Error('Could not resolve HEAD commit in isolated workspace.');
        }
        return sha;
    }

    private async resolveBaseCommit(workspacePath: string): Promise<string> {
        try {
            return await this.resolveHeadCommit(workspacePath);
        } catch (err) {
            const message = formatLoopError(err).toLowerCase();
            const isUnbornHead = message.includes('unknown revision') || message.includes('ambiguous argument');
            if (isUnbornHead) {
                console.log(
                    '[AgentRunner][ExecutionStage] Workspace has no initial commit; using empty tree as base diff'
                );
                return EMPTY_TREE_SHA;
            }
            throw err;
        }
    }

    private async ensureExecutionBranch(
        workspacePath: string,
        expectedBranchName?: string,
        runId?: string
    ): Promise<string> {
        const current = await this.resolveCurrentBranch(workspacePath);
        const currentBranch = isPlaceholderValue(current) ? '' : current;
        const requestedBranch = isPlaceholderValue(expectedBranchName)
            ? ''
            : (expectedBranchName || '').trim();
        const fallbackBranch = `devclaw/run-${(runId || 'unknown').slice(0, 8)}`;
        const targetBranch = requestedBranch || currentBranch || fallbackBranch;

        if (!targetBranch) {
            throw new Error('Could not resolve execution branch.');
        }

        if (current !== targetBranch) {
            console.log(
                `[AgentRunner][ExecutionStage] Switching workspace branch from ${current} to ${targetBranch}`
            );
            await this.runGit(['checkout', '-B', targetBranch], workspacePath);
        }

        return targetBranch;
    }

    private async resolveCurrentBranch(workspacePath: string): Promise<string> {
        const attempts: string[][] = [
            ['branch', '--show-current'],
            ['symbolic-ref', '--short', 'HEAD'],
            ['rev-parse', '--abbrev-ref', 'HEAD'],
        ];

        for (const args of attempts) {
            try {
                const value = (await this.runGit(args, workspacePath)).stdout.trim();
                if (value && value !== 'HEAD') {
                    return value;
                }
            } catch {
                // Try the next branch resolution strategy.
            }
        }

        return '';
    }

    private async ensureGitIdentity(workspacePath: string): Promise<void> {
        await this.runGit(['config', 'user.name', process.env.RUNNER_GIT_USER_NAME || 'DevClaw Agent Runner'], workspacePath);
        await this.runGit(['config', 'user.email', process.env.RUNNER_GIT_USER_EMAIL || 'agent-runner@devclaw.local'], workspacePath);
    }

    private async pushExecutionBranch(
        workspacePath: string,
        branchName: string,
        headCommit: string
    ): Promise<BranchPushResult> {
        if (!this.gitPushEnabled) {
            console.log(
                `[AgentRunner][ExecutionStage] Skipping branch push for ${branchName} (RUNNER_GIT_PUSH_ENABLED=false)`
            );
            return {
                remote: 'origin',
                branchName,
                headCommit,
                pushed: false,
            };
        }

        console.log(`[AgentRunner][ExecutionStage] Pushing branch ${branchName} to origin`);
        await this.runGit(['push', '--set-upstream', 'origin', branchName], workspacePath);
        return {
            remote: 'origin',
            branchName,
            headCommit,
            pushed: true,
        };
    }

    private async discardWorkingChanges(workspacePath: string): Promise<void> {
        try {
            await this.runGit(['reset', '--hard', 'HEAD'], workspacePath);
        } catch (err) {
            const message = formatLoopError(err).toLowerCase();
            const isUnbornHead = message.includes('unknown revision') || message.includes('ambiguous argument');
            if (isUnbornHead) {
                await this.runGit(['reset', '--hard'], workspacePath);
            } else {
                throw err;
            }
        }
        await this.runGit(['clean', '-fd'], workspacePath);
    }
}
