import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
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
//     userId: string,
//     channel: "telegram" | "whatsapp",
//     chatId: string,
//     repo: string,          // "owner/repo"
//     githubToken: string,
//     description: string,
//   }
//
// Responsibilities:
//   1. Validate input.
//   2. Create or deduplicate a GitHub issue.
//   3. Persist a task_run record to Supabase.
//   4. Send an approval card to the user's chat bot.
//   5. Return an ACK to the gateway.

app.post('/api/task', async (req: Request, res: Response): Promise<any> => {
    const { userId, channel, chatId, repo, githubToken, description } = req.body;

    if (!userId || !channel || !repo || !githubToken || !description) {
        return res.status(400).json({
            error: 'Missing required fields: userId, channel, repo, githubToken, description',
        });
    }

    const repoParts = repo.split('/');
    if (repoParts.length !== 2) {
        return res.status(400).json({ error: 'Invalid repo format. Expected "owner/repo".' });
    }
    const [owner, repoName] = repoParts;

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

    // ── Step 2: Persist task_run to Supabase ─────────────────────────────────
    if (supabase) {
        const { error: dbError } = await supabase.from('task_runs').upsert(
            {
                id: runId,
                user_id: userId,
                repo,
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

    // ── Step 3: Build approval card message ──────────────────────────────────
    const issueLabel = isDuplicate ? `🔗 Linked to existing issue #${issueNumber}` : `✅ Created issue #${issueNumber}`;
    const approvalMessage = [
        `${issueLabel} in \`${repo}\`:`,
        `${issueUrl}`,
        '',
        `📋 *${description}*`,
        '',
        `When you're ready, reply:`,
        `  /approve — to start implementation`,
        `  /reject — to cancel`,
    ].join('\n');

    // ── Step 4: Fire approval card to the user's chat (fire-and-forget) ──────
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

    // ── Step 5: Return ACK to gateway ────────────────────────────────────────
    const ackMessage = isDuplicate
        ? `🔗 I found an existing issue for this task: ${issueUrl}\n\nReply /approve to start implementation or /reject to cancel.`
        : `✅ I've opened a GitHub issue for your task: ${issueUrl}\n\nReply /approve to start implementation or /reject to cancel.`;

    return res.status(200).json({ success: true, message: ackMessage, issueNumber, issueUrl, runId });
});

// ─── Server Boot ─────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(port, () => {
        console.log(`[Orchestrator] Service listening on port ${port}`);
    });
}

export default app;
