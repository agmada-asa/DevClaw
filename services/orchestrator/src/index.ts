import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { IntakeRequest } from '@devclaw/contracts';
import { createOrDedupeIssue, fetchRepoTree } from './githubClient';
import { getOrchestrationEngine } from './orchestrationEngine';
import {
    buildExecutionSubTasks,
    provisionIsolatedExecutionEnvironment,
    resolveApprovedPlan,
    resolvePreferredExecutionBranch,
} from './executionPreparation';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const orchestrationEngine = getOrchestrationEngine();
const execFileAsync = promisify(execFile);

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const ORCHESTRATOR_BOT_SEND_TIMEOUT_MS = parsePositiveInt(
    process.env.ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
    20_000
);

const resolveBotUrl = (channel: unknown): string | undefined => {
    if (channel === 'telegram') {
        return process.env.TELEGRAM_BOT_URL;
    }
    if (channel === 'whatsapp') {
        return process.env.WHATSAPP_BOT_URL;
    }
    return undefined;
};

const formatErrorDetails = (err: any): string => {
    const message = err?.message || 'Unknown error';
    const status = err?.response?.status;
    const statusText = err?.response?.statusText;
    const url = err?.config?.url;
    const data = err?.response?.data;
    const dataText = data
        ? typeof data === 'string'
            ? data
            : JSON.stringify(data)
        : '';

    return [
        message,
        status ? `status=${status}${statusText ? ` ${statusText}` : ''}` : '',
        url ? `url=${url}` : '',
        dataText ? `data=${dataText}` : '',
    ]
        .filter(Boolean)
        .join(' | ');
};

const redactSecrets = (value: string): string =>
    value.replace(/(x-access-token:)[^@\s]+@/gi, '$1***@');

const runGitCommand = async (args: string[], cwd: string): Promise<string> => {
    try {
        const result = await execFileAsync('git', args, {
            cwd,
            timeout: 10 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',
            },
        });
        return (result.stdout || '').toString().trim();
    } catch (err: any) {
        const stderr = (err?.stderr || '').toString().trim();
        const stdout = (err?.stdout || '').toString().trim();
        const detail = redactSecrets(stderr || stdout || err?.message || 'unknown git failure');
        throw new Error(`git ${args.join(' ')} failed: ${detail}`);
    }
};

const attemptFallbackBranchPush = async (
    workspacePath: string,
    branchName: string
): Promise<{ pushed: boolean; headCommit?: string; error?: string }> => {
    try {
        const currentBranch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath);
        if (currentBranch !== branchName) {
            await runGitCommand(['checkout', branchName], workspacePath);
        }

        const headCommit = await runGitCommand(['rev-parse', 'HEAD'], workspacePath);
        await runGitCommand(['push', '-u', 'origin', branchName], workspacePath);
        return {
            pushed: true,
            headCommit,
        };
    } catch (err: any) {
        return {
            pushed: false,
            error: err?.message || 'fallback push failed',
        };
    }
};

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'orchestrator' });
});

// ─── POST /api/task ──────────────────────────────────────────────────────────
//
// Accepts a normalized task dispatch from the openclaw-gateway.
// Payload shape (matches IntakeRequest from docs/architecture/contracts.md):
//   {
//     requestId: string,
//     channel: "telegram" | "whatsapp",
//     userId: string,
//     repo: { owner: string, name: string },
//     message: string,
//     timestampIso: string,
//     chatId?: string
//   }
//
// Responsibilities:
//   1. Validate input.
//   2. Fetch github token from database.
//   3. Create or deduplicate a GitHub issue.
//   4. Persist a task_run record to Supabase.
//   5. Send an approval card to the user's chat bot.
//   6. Return an ACK to the gateway.

app.post('/api/task', async (req: Request, res: Response): Promise<any> => {
    const intake: IntakeRequest = req.body;
    const { userId, channel, chatId, repo, message: description } = intake;

    if (!userId || !channel || !repo || !repo.owner || !repo.name || !description) {
        return res.status(400).json({
            error: 'Missing required fields: userId, channel, repo, message',
        });
    }

    const owner = repo.owner;
    const repoName = repo.name;
    const repoFullName = `${owner}/${repoName}`;

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase is not configured' });
    }

    // ── Fetch GitHub Token ───────────────────────────────────────────────────
    const { data: userPrefs, error: prefsError } = await supabase
        .from('user_preferences')
        .select('github_token')
        .eq('user_id', userId)
        .single();

    if (prefsError || !userPrefs || !userPrefs.github_token) {
        return res.status(401).json({ error: 'No GitHub token found. Please /login first.' });
    }
    const githubToken = userPrefs.github_token;

    const runId = uuidv4();
    const issueTitle = `Task: ${description.slice(0, 80)}`;
    const issueBody = [
        `**Requested via:** ${channel}`,
        `**User ID:** ${userId}`,
        '',
        '### Description',
        description,
        '',
        '---',
        '_This issue was created automatically by DevClaw. Awaiting approval before execution._',
    ].join('\n');

    let issueNumber: number;
    let issueUrl: string;
    let isDuplicate: boolean;

    // ── Step 1: Create or deduplicate GitHub issue ──────────────────────────
    try {
        const result = await createOrDedupeIssue(githubToken, owner, repoName, issueTitle, issueBody);
        issueNumber = result.number;
        issueUrl = result.html_url;
        isDuplicate = result.isDuplicate;
        console.log(
            `[Orchestrator] ${isDuplicate ? 'Linked to existing' : 'Created new'} issue #${issueNumber}: ${issueUrl}`
        );
    } catch (err: any) {
        console.error('[Orchestrator] Failed to create/find GitHub issue:', formatErrorDetails(err));
        return res.status(502).json({
            error: 'Failed to create or find a GitHub issue. Check that the repo exists and the token has "repo" scope.',
        });
    }

    // ── Step 2: Return immediate ACK to gateway ──────────────────────────────
    const ackMessage = isDuplicate
        ? `🔗 Linked to existing issue: ${issueUrl}\n\n⚙️ I'm generating an architecture plan now. I'll message you when ready.`
        : `✅ Created new issue: ${issueUrl}\n\n⚙️ I'm generating an architecture plan now. I'll message you when ready.`;

    res.status(200).json({ success: true, message: ackMessage, issueNumber, issueUrl, runId });

    // ── Step 3: Asynchronous background processing ───────────────────────────
    (async () => {
        let repoFileTree: string[] | undefined;
        try {
            repoFileTree = await fetchRepoTree(githubToken, owner, repoName);
        } catch (e: any) {
            console.warn('[Orchestrator] Failed to fetch repo tree for planner context', e.message);
        }

        let plan: import('@devclaw/contracts').ArchitecturePlan | undefined;
        try {
            plan = await orchestrationEngine.plan({
                intake,
                repoFullName,
                issueNumber,
                repoFileTree,
            });
            console.log(`[Orchestrator] Fetched Architecture Plan ${plan?.planId}`);
        } catch (err: any) {
            console.error('[Orchestrator] Failed to fetch architecture plan:', formatErrorDetails(err));
            // Send failure message directly to chat
            if (chatId) {
                const failureMessage = `❌ *Plan generation failed*\n\nCouldn't create an architecture plan for issue #${issueNumber}.\n_${err?.message || 'Gateway timeout or planner unavailable.'}_\n\nTry again with /task`;
                const botUrl = resolveBotUrl(channel);

                if (botUrl) {
                    axios.post(`${botUrl}/api/send`, { chatId, message: failureMessage }, {
                        timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                    }).catch(e => console.error(e));
                }
            }
            return;
        }

        // ── Step 4: Persist task_run to Supabase ─────────────────────────────────
        if (supabase) {
            const { error: dbError } = await supabase.from('task_runs').upsert(
                {
                    id: runId,
                    plan_id: plan?.planId,
                    plan_details: plan,
                    user_id: userId,
                    repo: repoFullName,
                    issue_url: issueUrl,
                    issue_number: issueNumber,
                    description,
                    status: 'pending_approval',
                    channel,
                    chat_id: chatId,
                    created_at: new Date().toISOString(),
                },
                { onConflict: 'id' }
            );

            if (dbError) {
                console.warn('[Orchestrator] Could not persist task_run to Supabase:', dbError.message);
            }
        } else {
            console.warn('[Orchestrator] Supabase not configured — task_run will not be persisted.');
        }

        // ── Step 5: Build approval card message ──────────────────────────────────
        const issueLabel = isDuplicate ? `🔗 Linked to existing issue #${issueNumber}` : `✅ Created issue #${issueNumber}`;
        const formattedFiles = plan?.affectedFiles?.length ? plan.affectedFiles.map(f => `- \`${f}\``).join('\n') : '_None_';
        const formattedRisks = plan?.riskFlags?.length ? plan.riskFlags.map(r => `⚠️ ${r}`).join('\n') : '_None_';

        const approvalMessage = [
            `🤖 *DevClaw — Plan Ready*`,
            '',
            `${issueLabel}`,
            `🔗 ${issueUrl}`,
            '',
            `📋 *Task:* ${description}`,
            '',
            `🏗️ *Architecture Plan*`,
            `${plan?.summary || 'No summary available.'}`,
            '',
            `📂 *Files to change:*`,
            `${formattedFiles}`,
            '',
            ...(plan?.riskFlags?.length ? [`⚠️ *Risks:*`, `${formattedRisks}`, ''] : []),
            `─────────────────────`,
            `✅ /approve ${plan?.planId}`,
            `✏️ /refine ${plan?.planId} [your changes]`,
            `❌ /reject ${plan?.planId}`,
        ].join('\n');

        // ── Step 6: Fire approval card to the user's chat (fire-and-forget) ──────
        if (chatId) {
            const botUrl = resolveBotUrl(channel);

            if (botUrl) {
                axios
                    .post(`${botUrl}/api/send`, { chatId, message: approvalMessage }, {
                        timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                    })
                    .then(() =>
                        console.log(`[Orchestrator] Sent approval card to ${channel} chat ${chatId}`)
                    )
                    .catch((err) =>
                        console.error(
                            `[Orchestrator] Failed to send approval card to ${channel}:`,
                            err.message
                        )
                    );
            } else {
                console.warn(
                    `[Orchestrator] No bot URL configured for channel "${channel}". ` +
                    `Set ${channel.toUpperCase()}_BOT_URL in .env to enable approval cards.`
                );
            }
        }
    })();
});

// ─── POST /api/approve ───────────────────────────────────────────────────────
app.post('/api/approve', async (req: Request, res: Response): Promise<any> => {
    const { runId, planId } = req.body;

    if (!runId && !planId) {
        return res.status(400).json({ error: 'Must provide runId or planId' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase is not configured' });
    }

    const matchQuery = runId ? { id: runId } : { plan_id: planId };

    const { data: updated, error } = await supabase
        .from('task_runs')
        .update({ status: 'approved' })
        .match(matchQuery)
        .select()
        .single();

    if (error || !updated) {
        return res.status(404).json({ error: 'Task run not found' });
    }

    if (updated.chat_id) {
        const botUrl = resolveBotUrl(updated.channel);
        if (botUrl) {
            const inProgressMessage = [
                `⚡ *Execution started!*`,
                '',
                `The DevClaw agents are now implementing your task for *${updated.repo || 'your repository'}*.`,
                `_I'll notify you when the code is ready with a link to the branch._`,
            ].join('\n');
            axios
                .post(`${botUrl}/api/send`, {
                    chatId: updated.chat_id,
                    message: inProgressMessage,
                }, {
                    timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                })
                .then(() => {
                    console.log(
                        `[Orchestrator] Sent execution-start update to ${updated.channel} chat ${updated.chat_id}`
                    );
                })
                .catch((notifyErr: any) => {
                    console.warn(
                        `[Orchestrator] Failed to send execution-start update to ${updated.channel}: ` +
                        `${notifyErr?.message || notifyErr}`
                    );
                });
        }
    }

    console.log(`[Orchestrator] Task ${updated.id} (plan ${updated.plan_id}) was APPROVED`);
    res.status(200).json({
        success: true,
        message: 'Task approved and dispatched for execution',
        task: updated,
        execution: {
            status: 'queued',
        },
    });

    // Run execution asynchronously to prevent gateway timeouts
    (async () => {
        let execution: import('./orchestrationEngine').ExecuteResult | undefined;
        let preparation:
            | {
                isolatedEnvironmentPath: string;
                executionBranchName: string;
                subTaskCount: number;
            }
            | undefined;
        try {
            const approvedPlan = resolveApprovedPlan(updated.plan_details);
            if (!approvedPlan) {
                console.error('[Orchestrator] Approved task is missing a valid architecture plan.', updated);
                return;
            }

            if (!updated.repo || typeof updated.repo !== 'string') {
                console.error('[Orchestrator] Approved task is missing repository metadata for execution.', updated);
                return;
            }

            const executionSubTasks = buildExecutionSubTasks(approvedPlan);
            const preferredBranch = resolvePreferredExecutionBranch(
                updated.plan_details,
                updated.plan_id,
                updated.description
            );

            let githubToken: string | undefined;
            if (updated.user_id) {
                const { data: userPrefs, error: prefsError } = await supabase
                    .from('user_preferences')
                    .select('github_token')
                    .eq('user_id', updated.user_id)
                    .single();

                if (!prefsError && userPrefs?.github_token) {
                    githubToken = userPrefs.github_token;
                }
            }

            const isolatedEnvironment = await provisionIsolatedExecutionEnvironment({
                runId: updated.id,
                repoFullName: updated.repo,
                planId: approvedPlan.planId || updated.plan_id,
                description: updated.description || approvedPlan.summary,
                planDetails: updated.plan_details,
                preferredBranchName: preferredBranch.branchName,
                githubToken,
            });

            preparation = {
                isolatedEnvironmentPath: isolatedEnvironment.workspacePath,
                executionBranchName: isolatedEnvironment.branchName,
                subTaskCount: executionSubTasks.length,
            };

            execution = await orchestrationEngine.execute({
                runId: updated.id,
                planId: approvedPlan.planId || updated.plan_id,
                requestId: approvedPlan.requestId,
                userId: updated.user_id,
                repo: updated.repo,
                issueNumber: updated.issue_number,
                issueUrl: updated.issue_url,
                description: updated.description,
                planDetails: approvedPlan,
                executionSubTasks,
                isolatedEnvironmentPath: isolatedEnvironment.workspacePath,
                executionBranchName: isolatedEnvironment.branchName,
            });

            const branchPush = execution.branchPush as any | undefined;

            if (
                execution.engine === 'openclaw' &&
                preparation?.isolatedEnvironmentPath &&
                branchPush?.pushed === false &&
                typeof branchPush?.branchName === 'string' &&
                branchPush.branchName.trim().length > 0
            ) {
                const fallbackPush = await attemptFallbackBranchPush(
                    preparation.isolatedEnvironmentPath,
                    branchPush.branchName.trim()
                );

                if (fallbackPush.pushed) {
                    execution.branchPush = {
                        ...(branchPush || {}),
                        pushed: true,
                        headCommit: fallbackPush.headCommit || branchPush.headCommit,
                    };
                    console.log(
                        `[Orchestrator] Fallback push succeeded for run ${updated.id}: ` +
                        `branch=${branchPush.branchName}`
                    );
                } else {
                    execution.branchPush = {
                        ...(branchPush || {}),
                        pushed: false,
                        error: fallbackPush.error,
                    };
                    console.warn(
                        `[Orchestrator] Fallback push failed for run ${updated.id}: ` +
                        `${fallbackPush.error || 'unknown error'}`
                    );
                }
            }

            if (execution.approvedPatchSet) {
                const patchSetRef = (execution.approvedPatchSet as any)?.patchSetRef || 'n/a';
                console.log(
                    `[Orchestrator] Received approved patch set for run ${updated.id}: ${patchSetRef}`
                );
            }
            if (execution.branchPush) {
                const branchName = (execution.branchPush as any)?.branchName || 'n/a';
                const pushed = (execution.branchPush as any)?.pushed;
                console.log(
                    `[Orchestrator] Execution branch status for run ${updated.id}: ` +
                    `branch=${branchName} pushed=${String(pushed)}`
                );
                if (updated.chat_id) {
                    const botUrl = resolveBotUrl(updated.channel);
                    if (botUrl) {
                        const branchUrl = `https://github.com/${updated.repo}/tree/${branchName}`;
                        const completionMessage = [
                            `✅ *Code is ready!*`,
                            '',
                            `Your task has been implemented for *${updated.repo}*.`,
                            '',
                            `🌿 *Branch:* \`${branchName}\``,
                            `🔗 ${pushed ? branchUrl : '_Branch not pushed_'}`,
                            '',
                            `_Review the changes and merge when ready._`,
                        ].join('\n');
                        axios.post(`${botUrl}/api/send`, {
                            chatId: updated.chat_id,
                            message: completionMessage,
                        }, { timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS }).catch(() => { });
                    }
                }
            }
            console.log(`[Orchestrator] Task ${updated.id} execution completed asynchronously.`);

            // Attempt to mark the task run as completed in Supabase (best-effort).
            if (supabase) {
                try {
                    const { error: completionError } = await supabase
                        .from('task_runs')
                        .update({ status: 'completed' })
                        .eq('id', updated.id);
                    if (completionError) {
                        console.warn(
                            '[Orchestrator] Could not update task_run status to completed:',
                            completionError.message
                        );
                    }
                } catch (dbErr: any) {
                    console.warn(
                        '[Orchestrator] Unexpected error while updating task_run status to completed:',
                        dbErr?.message || dbErr
                    );
                }
            }

            // Send a summary back to the user with a link to the GitHub commit/branch.
            if (updated.chat_id) {
                const botUrl = resolveBotUrl(updated.channel);
                if (botUrl) {
                    const approvedPatchSet = execution.approvedPatchSet as any | undefined;
                    const branchPush = execution.branchPush as any | undefined;

                    const flattenedChangedFiles: string[] = (approvedPatchSet?.subTasks || [])
                        .flatMap((st: any) => Array.isArray(st?.filesChanged) ? st.filesChanged : [])
                        .filter((f: unknown): f is string => typeof f === 'string' && f.trim().length > 0);

                    const changedFiles: string[] = Array.from(new Set<string>(flattenedChangedFiles)).slice(0, 50);

                    const filesSection = changedFiles.length
                        ? changedFiles.map((f) => `- \`${f}\``).join('\n')
                        : '_Unknown — execution engine did not report specific files._';

                    const repoFullName = typeof updated.repo === 'string' ? updated.repo : undefined;
                    const headCommit = typeof branchPush?.headCommit === 'string' ? branchPush.headCommit : undefined;
                    const branchName = typeof branchPush?.branchName === 'string' ? branchPush.branchName : undefined;

                    const commitUrl =
                        repoFullName && headCommit
                            ? `https://github.com/${repoFullName}/commit/${headCommit}`
                            : '';
                    const branchUrl =
                        repoFullName && branchName
                            ? `https://github.com/${repoFullName}/tree/${branchName}`
                            : '';

                    const commitLine = commitUrl ? `🔗 *Latest commit:* ${commitUrl}` : '';
                    const branchLine = branchUrl ? `🌿 *Execution branch:* ${branchUrl}` : '';

                    const pushStatusLine =
                        // !hasCodeChanges
                        //     ? '⚠️ Execution completed, but no code changes were generated, so nothing was pushed to GitHub.'
                        //     : branchPush && branchPush.pushed === false
                        //         ? `⚠️ I generated code changes but could not push the branch.${branchPush.error ? `\nReason: ${branchPush.error}` : ''
                        //         }`
                        //         : '✅ All requested changes have been implemented and pushed to GitHub.';

                        branchPush && branchPush.pushed === false
                            ? '⚠️ I generated code changes but did not push a branch. You may need to apply the patch manually.'
                            : '✅ All requested changes have been implemented and pushed to GitHub.';
                    const engineLabel =
                        execution.engine === 'openclaw'
                            ? 'OpenClaw execution engine'
                            : 'Agent Runner execution engine';

                    const summaryLines = [
                        `✅ Execution finished for plan ${updated.plan_id || 'unknown'} in \`${repoFullName || 'your repository'}\`.`,
                        '',
                        `🧠 *Engine:* ${engineLabel}`,
                        `📌 *Run ID:* ${updated.id}`,
                        '',
                        `📋 *Task:* ${updated.description || 'n/a'}`,
                        '',
                        `🗂️ *Files changed:*`,
                        filesSection,
                        '',
                        ...(commitLine ? [commitLine] : []),
                        ...(branchLine ? [branchLine] : []),
                        '',
                        pushStatusLine,
                        '',
                        'You can edit or revert these changes directly on GitHub if needed.',
                    ];

                    const summaryMessage = summaryLines.join('\n');

                    axios.post(`${botUrl}/api/send`, {
                        chatId: updated.chat_id,
                        message: summaryMessage,
                    }, {
                        timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                    }).then(() => {
                        console.log(
                            `[Orchestrator] Sent execution-complete summary to ${updated.channel} chat ${updated.chat_id}`
                        );
                    }).catch((notifyErr: any) => {
                        console.warn(
                            `[Orchestrator] Failed to send execution-complete summary to ${updated.channel}: ` +
                            `${notifyErr?.message || notifyErr}`
                        );
                    });
                }
            }
        } catch (err: any) {
            console.error('[Orchestrator] Failed to dispatch approved task for execution:', formatErrorDetails(err));
            if (updated.chat_id) {
                const botUrl = resolveBotUrl(updated.channel);
                if (botUrl) {
                    axios.post(`${botUrl}/api/send`, {
                        chatId: updated.chat_id,
                        message: `❌ *Execution failed*\n\nSomething went wrong while implementing your task.\n_${err?.message || 'Unknown error'}_\n\nPlease try again with /task`,
                    }, { timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS }).catch(() => { });
                }
            }
        }
    })();
});

// ─── POST /api/reject ────────────────────────────────────────────────────────
app.post('/api/reject', async (req: Request, res: Response): Promise<any> => {
    const { runId, planId } = req.body;

    if (!runId && !planId) {
        return res.status(400).json({ error: 'Must provide runId or planId' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase is not configured' });
    }

    const matchQuery = runId ? { id: runId } : { plan_id: planId };

    const { data: updated, error } = await supabase
        .from('task_runs')
        .update({ status: 'rejected' })
        .match(matchQuery)
        .select()
        .single();

    if (error || !updated) {
        return res.status(404).json({ error: 'Task run not found' });
    }

    console.log(`[Orchestrator] Task ${updated.id} (plan ${updated.plan_id}) was REJECTED`);
    return res.status(200).json({ success: true, message: 'Task rejected', task: updated });
});

// ─── POST /api/refine ────────────────────────────────────────────────────────
app.post('/api/refine', async (req: Request, res: Response): Promise<any> => {
    const { planId, refinement, userId, channel, chatId } = req.body;

    if (!planId || !refinement) {
        return res.status(400).json({ error: 'Must provide planId and refinement' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase is not configured' });
    }

    const { data: existingRun, error } = await supabase
        .from('task_runs')
        .select('*')
        .eq('plan_id', planId)
        .single();

    if (error || !existingRun) {
        return res.status(404).json({ error: 'Task run not found' });
    }

    if (existingRun.status !== 'pending_approval') {
        return res.status(400).json({ error: `Cannot refine task in status ${existingRun.status}` });
    }

    // Acknowledge receipt to gateway immediately
    res.status(200).json({ success: true, message: `⚙️ Refining plan ${planId} with your instructions... I'll message you when it's updated.` });

    // Process refinement in the background
    (async () => {
        let refinedPlan: import('@devclaw/contracts').ArchitecturePlan | undefined;
        try {
            refinedPlan = await orchestrationEngine.refine({
                planId,
                repoFullName: existingRun.repo,
                changeRequest: refinement,
                issueNumber: existingRun.issue_number
            });
            console.log(`[Orchestrator] Fetched Refined Architecture Plan ${refinedPlan?.planId}`);
        } catch (err: any) {
            console.error('[Orchestrator] Failed to fetch refined architecture plan:', formatErrorDetails(err));
            if (chatId || existingRun.chat_id) {
                const targetChatId = chatId || existingRun.chat_id;
                const failureMessage = `❌ *Refinement failed*\n\nCouldn't update the plan for issue #${existingRun.issue_number}.\n_${err?.message || 'Gateway timeout or planner unavailable.'}_\n\nTry again with *refine [your instructions]*`;
                const targetChannel = channel || existingRun.channel;
                const botUrl = resolveBotUrl(targetChannel);

                if (botUrl) {
                    axios.post(`${botUrl}/api/send`, { chatId: targetChatId, message: failureMessage }, {
                        timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                    }).catch(e => console.error(e));
                }
            }
            return;
        }

        // Persist updated plan to Supabase
        const { error: dbError } = await supabase.from('task_runs').update({
            plan_id: refinedPlan.planId,
            plan_details: refinedPlan,
        }).eq('id', existingRun.id);

        if (dbError) {
            console.warn('[Orchestrator] Could not update task_run with refined plan:', dbError.message);
        }

        // Send updated approval card to user's chat
        const issueLabel = `🔄 Plan Updated for issue #${existingRun.issue_number}`;
        const formattedFiles = refinedPlan?.affectedFiles?.length ? refinedPlan.affectedFiles.map(f => `- \`${f}\``).join('\n') : '_None_';
        const formattedRisks = refinedPlan?.riskFlags?.length ? refinedPlan.riskFlags.map(r => `⚠️ ${r}`).join('\n') : '_None_';

        const approvalMessage = [
            `🔄 *DevClaw — Plan Updated*`,
            '',
            `${issueLabel}`,
            `🔗 ${existingRun.issue_url}`,
            '',
            `📋 *Task:* ${existingRun.description}`,
            '',
            `🏗️ *New Architecture Plan*`,
            `${refinedPlan?.summary || 'No summary available.'}`,
            '',
            `📂 *Files to change:*`,
            `${formattedFiles}`,
            '',
            ...(refinedPlan?.riskFlags?.length ? [`⚠️ *Risks:*`, `${formattedRisks}`, ''] : []),
            `─────────────────────`,
            `✅ /approve ${refinedPlan?.planId}`,
            `✏️ /refine ${refinedPlan?.planId} [your changes]`,
            `❌ /reject ${refinedPlan?.planId}`,
        ].join('\n');

        const botChannel = channel || existingRun.channel;
        const targetChatId = chatId || existingRun.chat_id;
        if (targetChatId) {
            const botUrl = resolveBotUrl(botChannel);

            if (botUrl) {
                axios.post(`${botUrl}/api/send`, { chatId: targetChatId, message: approvalMessage }, {
                    timeout: ORCHESTRATOR_BOT_SEND_TIMEOUT_MS,
                }).catch(e => console.error(e));
            }
        }
    })();
});

// ─── Server Boot ─────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[Orchestrator] Service listening on port ${port}`);
    });
}

export default app;
