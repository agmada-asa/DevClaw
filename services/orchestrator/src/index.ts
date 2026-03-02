import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { IntakeRequest } from '@devclaw/contracts';
import { createOrDedupeIssue } from './githubClient';
import { getOrchestrationEngine } from './orchestrationEngine';

dotenv.config();

const app = express();
const port = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const orchestrationEngine = getOrchestrationEngine();

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
        let plan: import('@devclaw/contracts').ArchitecturePlan | undefined;
        try {
            plan = await orchestrationEngine.plan({
                intake,
                repoFullName,
                issueNumber,
            });
            console.log(`[Orchestrator] Fetched Architecture Plan ${plan?.planId}`);
        } catch (err: any) {
            console.error('[Orchestrator] Failed to fetch architecture plan:', formatErrorDetails(err));
            // Send failure message directly to chat
            if (chatId) {
                const failureMessage = `❌ Oh no! I failed to generate the architecture plan for issue #${issueNumber}.\nError: ${err?.message || 'Gateway timeout or planner unavailable.'}`;
                let botUrl: string | undefined;
                if (channel === 'telegram') botUrl = process.env.TELEGRAM_BOT_URL;
                else if (channel === 'whatsapp') botUrl = process.env.WHATSAPP_BOT_URL;

                if (botUrl) {
                    axios.post(`${botUrl}/api/send`, { chatId, message: failureMessage }).catch(e => console.error(e));
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
            `${issueLabel} in \`${repoFullName}\`:`,
            `${issueUrl}`,
            '',
            `📋 *Task:* ${description}`,
            '',
            `🏗️ *Architecture Plan (${plan?.planId || 'unknown'})*`,
            `${plan?.summary || 'No summary available.'}`,
            '',
            `*Affected Files:*`,
            `${formattedFiles}`,
            '',
            `*Risk Flags:*`,
            `${formattedRisks}`,
            '',
            `When you're ready, reply:`,
            `  /approve ${plan?.planId} — to start implementation`,
            `  /refine ${plan?.planId} [instructions] — to adjust the plan`,
            `  /reject ${plan?.planId} — to cancel`,
        ].join('\n');

        // ── Step 6: Fire approval card to the user's chat (fire-and-forget) ──────
        if (chatId) {
            let botUrl: string | undefined;
            if (channel === 'telegram') {
                botUrl = process.env.TELEGRAM_BOT_URL;
            } else if (channel === 'whatsapp') {
                botUrl = process.env.WHATSAPP_BOT_URL;
            }

            if (botUrl) {
                axios
                    .post(`${botUrl}/api/send`, { chatId, message: approvalMessage })
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

    let execution: import('./orchestrationEngine').ExecuteResult | undefined;
    try {
        execution = await orchestrationEngine.execute({
            runId: updated.id,
            planId: updated.plan_id,
            requestId: updated.plan_details?.requestId,
            userId: updated.user_id,
            repo: updated.repo,
            issueNumber: updated.issue_number,
            issueUrl: updated.issue_url,
            description: updated.description,
            planDetails: updated.plan_details,
        });
    } catch (err: any) {
        console.error('[Orchestrator] Failed to dispatch approved task for execution:', formatErrorDetails(err));
        return res.status(502).json({
            error: 'Task was approved but execution dispatch failed.',
            task: updated,
        });
    }

    console.log(`[Orchestrator] Task ${updated.id} (plan ${updated.plan_id}) was APPROVED`);
    return res.status(200).json({
        success: true,
        message: 'Task approved and dispatched for execution',
        task: updated,
        execution,
    });
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
                const failureMessage = `❌ I failed to refine the architecture plan for issue #${existingRun.issue_number}.\nError: ${err?.message || 'Gateway timeout or planner unavailable.'}`;
                let botUrl: string | undefined;
                const targetChannel = channel || existingRun.channel;
                if (targetChannel === 'telegram') botUrl = process.env.TELEGRAM_BOT_URL;
                else if (targetChannel === 'whatsapp') botUrl = process.env.WHATSAPP_BOT_URL;

                if (botUrl) {
                    axios.post(`${botUrl}/api/send`, { chatId: targetChatId, message: failureMessage }).catch(e => console.error(e));
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
            `${issueLabel} in \`${existingRun.repo}\`:`,
            `${existingRun.issue_url}`,
            '',
            `📋 *Task:* ${existingRun.description}`,
            '',
            `🏗️ *New Architecture Plan (${refinedPlan?.planId || 'unknown'})*`,
            `${refinedPlan?.summary || 'No summary available.'}`,
            '',
            `*Affected Files:*`,
            `${formattedFiles}`,
            '',
            `*Risk Flags:*`,
            `${formattedRisks}`,
            '',
            `When you're ready, reply:`,
            `  /approve ${refinedPlan?.planId} — to start implementation`,
            `  /refine ${refinedPlan?.planId} [instructions] — to adjust the plan`,
            `  /reject ${refinedPlan?.planId} — to cancel`,
        ].join('\n');

        const botChannel = channel || existingRun.channel;
        const targetChatId = chatId || existingRun.chat_id;
        if (targetChatId) {
            let botUrl: string | undefined;
            if (botChannel === 'telegram') botUrl = process.env.TELEGRAM_BOT_URL;
            else if (botChannel === 'whatsapp') botUrl = process.env.WHATSAPP_BOT_URL;

            if (botUrl) {
                axios.post(`${botUrl}/api/send`, { chatId: targetChatId, message: approvalMessage }).catch(e => console.error(e));
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
