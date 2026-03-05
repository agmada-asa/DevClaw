import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface OpenClawExecutePayload {
    runId: string;
    planId?: string;
    requestId?: string;
    userId?: string;
    repo?: string;
    issueNumber?: number;
    issueUrl?: string;
    description?: string;
    plan?: unknown;
    executionSubTasks?: ExecutionSubTask[];
    isolatedEnvironmentPath?: string;
    executionBranchName?: string;
    [key: string]: unknown;
}

export interface ExecutionSubTask {
    id: string;
    domain: 'frontend' | 'backend';
    agent: 'Frontend' | 'Backend';
    objective: string;
    files: string[];
    generator: string;
    reviewer: string;
}

export interface ApprovedPatchSubTask {
    subTaskId: string;
    domain: ExecutionSubTask['domain'];
    agent: ExecutionSubTask['agent'];
    generator: string;
    reviewer: string;
    iterations: number;
    reviewerNotes: string[];
    filesChanged: string[];
    commitSha: string;
    patch: string;
}

export interface ApprovedPatchSet {
    patchSetRef: string;
    runId: string;
    planId?: string;
    branchName: string;
    baseCommit: string;
    headCommit: string;
    createdAt: string;
    subTasks: ApprovedPatchSubTask[];
    patch: string;
}

export interface BranchPushResult {
    remote: string;
    branchName: string;
    headCommit: string;
    pushed: boolean;
}

export interface OpenClawExecuteDispatchResult {
    runRef: string;
    engine: string;
    accepted: boolean;
    approvedPatchSet?: ApprovedPatchSet;
    branchPush?: BranchPushResult;
    [key: string]: unknown;
}

export interface OpenClawExecutionDispatcher {
    dispatch(payload: OpenClawExecutePayload): Promise<OpenClawExecuteDispatchResult>;
}

class LocalOpenClawExecutionDispatcher implements OpenClawExecutionDispatcher {
    private readonly timeoutMs = (() => {
        const parsed = Number.parseInt(process.env.OPENCLAW_EXECUTION_TIMEOUT_MS || '', 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        return 4 * 60 * 60 * 1000;
    })();

    private readonly cliBin = process.env.OPENCLAW_CLI_BIN || 'openclaw';

    private readonly localTo = process.env.OPENCLAW_LOCAL_TO || '+15555550123';

    private readonly gitPushEnabled = true

    private readonly gitAuthorName = process.env.OPENCLAW_GIT_AUTHOR_NAME || 'DevClaw';

    private readonly gitAuthorEmail = process.env.OPENCLAW_GIT_AUTHOR_EMAIL || 'devclaw26@gmail.com';

    private async runCli(
        command: string,
        args: string[],
        cwd: string,
        timeoutMs = this.timeoutMs
    ): Promise<{ stdout: string; stderr: string }> {
        try {
            const result = await execFileAsync(command, args, {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 12 * 1024 * 1024,
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
            const detail = stderr || stdout || err?.message || 'unknown command failure';
            throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
        }
    }

    private async runGit(
        args: string[],
        cwd: string,
        timeoutMs = this.timeoutMs
    ): Promise<string> {
        const result = await this.runCli('git', args, cwd, timeoutMs);
        return result.stdout.trim();
    }

    private buildExecutionPrompt(payload: OpenClawExecutePayload, workspacePath: string): string {
        return [
            'You are OpenClaw execution engine. Your job is to implement the task described below by',
            'writing real code changes to disk using your write and edit tools.',
            '',
            `WORKSPACE DIRECTORY: ${workspacePath}`,
            '',
            'CRITICAL INSTRUCTIONS:',
            `1. All file paths you read or write MUST be absolute paths inside: ${workspacePath}`,
            '2. Use your write tool (or edit tool) to write every changed file to disk.',
            '3. Do NOT just describe the changes — actually write the files using your tools.',
            '4. Do NOT call external APIs or model providers.',
            '5. Keep changes scoped to the provided subtasks and plan.',
            '',
            `runId: ${payload.runId}`,
            `planId: ${payload.planId || 'n/a'}`,
            `requestId: ${payload.requestId || 'n/a'}`,
            `repo: ${payload.repo || 'n/a'}`,
            `issueNumber: ${typeof payload.issueNumber === 'number' ? payload.issueNumber : 'n/a'}`,
            `executionBranch: ${payload.executionBranchName || 'n/a'}`,
            `description: ${payload.description || 'n/a'}`,
            '',
            'plan:',
            JSON.stringify(payload.plan || {}, null, 2),
            '',
            'executionSubTasks:',
            JSON.stringify(payload.executionSubTasks || [], null, 2),
            '',
            'Once all files are written to disk, return a plain-text summary of the files you changed.',
        ].join('\n');
    }

    private async ensureBranch(workspacePath: string, branchName?: string): Promise<string> {
        if (!branchName || !branchName.trim()) {
            const current = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath);
            return current || 'main';
        }

        const normalized = branchName.trim();
        try {
            await this.runGit(['checkout', normalized], workspacePath);
            return normalized;
        } catch {
            await this.runGit(['checkout', '-b', normalized], workspacePath);
            return normalized;
        }
    }

    private async collectChangedFiles(workspacePath: string): Promise<string[]> {
        const status = await this.runGit(['status', '--porcelain'], workspacePath);
        if (!status) {
            return [];
        }
        return status
            .split('\n')
            .map((line) => line.slice(3).trim())
            .filter(Boolean);
    }

    private buildSubTaskPatchView(
        subTask: ExecutionSubTask,
        changedFiles: string[],
        commitSha: string,
        patch: string
    ): ApprovedPatchSubTask {
        const mappedFiles = changedFiles.filter((filePath) =>
            Array.isArray(subTask.files) && subTask.files.some((target) => target === filePath)
        );

        return {
            subTaskId: subTask.id,
            domain: subTask.domain,
            agent: subTask.agent,
            generator: subTask.generator,
            reviewer: subTask.reviewer,
            iterations: 1,
            reviewerNotes: ['Executed by OpenClaw local engine in isolated Docker workspace.'],
            filesChanged: mappedFiles.length > 0 ? mappedFiles : changedFiles,
            commitSha,
            patch,
        };
    }

    async dispatch(payload: OpenClawExecutePayload): Promise<OpenClawExecuteDispatchResult> {
        if (!payload.isolatedEnvironmentPath || !payload.isolatedEnvironmentPath.trim()) {
            throw new Error('OpenClaw execution requires isolatedEnvironmentPath.');
        }

        const workspacePath = path.resolve(payload.isolatedEnvironmentPath);
        await access(workspacePath, fsConstants.F_OK | fsConstants.R_OK | fsConstants.W_OK);
        await this.runGit(['rev-parse', '--is-inside-work-tree'], workspacePath);

        const branchName = await this.ensureBranch(workspacePath, payload.executionBranchName);

        let baseCommit = EMPTY_TREE_SHA;
        try {
            const resolved = await this.runGit(['rev-parse', 'HEAD'], workspacePath);
            if (resolved) {
                baseCommit = resolved;
            }
        } catch {
            baseCommit = EMPTY_TREE_SHA;
        }

        await this.runGit(['config', 'user.name', this.gitAuthorName], workspacePath);
        await this.runGit(['config', 'user.email', this.gitAuthorEmail], workspacePath);

        const prompt = this.buildExecutionPrompt(payload, workspacePath);
        const timeoutSeconds = Math.max(1, Math.ceil(this.timeoutMs / 1000));
        await this.runCli(
            this.cliBin,
            [
                'agent',
                '--local',
                '--to',
                this.localTo,
                '--timeout',
                String(timeoutSeconds),
                '--message',
                prompt,
            ],
            workspacePath,
            this.timeoutMs + 10_000
        );

        const changedFiles = await this.collectChangedFiles(workspacePath);
        const patch = changedFiles.length > 0
            ? await this.runGit(['diff', '--binary'], workspacePath)
            : '';

        let headCommit = baseCommit;
        if (changedFiles.length > 0) {
            await this.runGit(['add', '--all'], workspacePath);
            const message = payload.description?.trim()
                ? `OpenClaw execution: ${payload.description.trim().slice(0, 120)}`
                : `OpenClaw execution run ${payload.runId}`;
            await this.runGit(['commit', '-m', message], workspacePath);
            headCommit = await this.runGit(['rev-parse', 'HEAD'], workspacePath);
        }

        let pushed = false;
        if (changedFiles.length > 0 && this.gitPushEnabled) {
            await this.runGit(['push', '-u', 'origin', branchName], workspacePath);
            pushed = true;
        }

        const subTasks = Array.isArray(payload.executionSubTasks)
            ? payload.executionSubTasks
            : [];

        const approvedPatchSet: ApprovedPatchSet = {
            patchSetRef: `openclaw-${payload.runId}-${Date.now()}`,
            runId: payload.runId,
            planId: payload.planId,
            branchName,
            baseCommit,
            headCommit,
            createdAt: new Date().toISOString(),
            subTasks: subTasks.map((subTask) =>
                this.buildSubTaskPatchView(subTask, changedFiles, headCommit, patch)
            ),
            patch,
        };

        return {
            runRef: `openclaw-${payload.runId}`,
            engine: 'openclaw',
            accepted: true,
            approvedPatchSet,
            branchPush: {
                remote: 'origin',
                branchName,
                headCommit,
                pushed,
            },
        };
    }
}

export const getExecutionDispatcher = (): OpenClawExecutionDispatcher =>
    new LocalOpenClawExecutionDispatcher();
