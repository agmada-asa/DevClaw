import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { IntakeRequest } from '@devclaw/contracts';
import { createOrDedupeIssue } from './githubClient';

dotenv.config();

const app = express();
const port = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
        console.error('[Orchestrator] Failed to create/find GitHub issue:', err.response?.data || err.message);
        return res.status(502).json({
            error: 'Failed to create or find a GitHub issue. Check that the repo exists and the token has "repo" scope.',
        });
    }

    // ── Step 2: Fetch Architecture Plan ──────────────────────────────────────
    let plan: import('@devclaw/contracts').ArchitecturePlan | undefined;
    try {
        const plannerUrl = process.env.ARCHITECTURE_PLANNER_URL || 'http://localhost:3020';
        // Use IntakeRequest + issueNumber? Or just forward intake payload. We'll send what's needed.
        const plannerRes = await axios.post(`${plannerUrl}/api/plan`, {
            requestId: intake.requestId,
            userId,
            repo: repoFullName,
            description,
            issueNumber
        });
        plan = plannerRes.data;
        console.log(`[Orchestrator] Fetched Architecture Plan ${plan?.planId}`);
    } catch (err: any) {
        console.error('[Orchestrator] Failed to fetch architecture plan:', err.response?.data || err.message);
        return res.status(502).json({
            error: 'Failed to generate architecture plan from planner service.',
        });
    }

    // ── Step 3: Persist task_run to Supabase ─────────────────────────────────
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
            // Non-fatal: log and continue (table may not exist yet in early dev)
            console.warn('[Orchestrator] Could not persist task_run to Supabase:', dbError.message);
        }
    } else {
        console.warn('[Orchestrator] Supabase not configured — task_run will not be persisted.');
    }

    // ── Step 4: Build approval card message ──────────────────────────────────
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
        `  /reject ${plan?.planId} — to cancel`,
    ].join('\n');

    // ── Step 5: Fire approval card to the user's chat (fire-and-forget) ──────
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

    // ── Step 6: Return ACK to gateway ────────────────────────────────────────
    const ackMessage = isDuplicate
        ? `🔗 I found an existing issue for this task: ${issueUrl}\n\nReply /approve ${plan?.planId} to start implementation or /reject ${plan?.planId} to cancel.`
        : `✅ I've opened a GitHub issue for your task: ${issueUrl}\n\nReply /approve ${plan?.planId} to start implementation or /reject ${plan?.planId} to cancel.`;

    return res.status(200).json({ success: true, message: ackMessage, issueNumber, issueUrl, runId });
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

    console.log(`[Orchestrator] Task ${updated.id} (plan ${updated.plan_id}) was APPROVED`);
    return res.status(200).json({ success: true, message: 'Task approved', task: updated });
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

// ─── Server Boot ─────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[Orchestrator] Service listening on port ${port}`);
    });
}

export default app;
