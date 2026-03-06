/**
 * founderLoop.ts
 *
 * The autonomous CEOClaw founder agent loop.
 *
 * This is what makes CEOClaw an AGENT, not just an API:
 *
 *   while (running) {
 *     state  = loadBusinessState()
 *     task   = routeNextTask(state, recentHistory)   ← OpenClaw decides
 *     output = executeTask(task, state)               ← domain module runs
 *     record(task, output)                            → Supabase task_log
 *     updateState(state, task, output)                → Supabase business_state
 *     sleep(CEOCLAW_LOOP_INTERVAL_MS)
 *   }
 *
 * Start/stop via Express API:
 *   POST /api/loop/start
 *   POST /api/loop/stop
 *   POST /api/loop/tick   (manual single iteration — useful for demos)
 */

import { v4 as uuidv4 } from 'uuid';
import { routeNextTask } from './taskRouter';
import { generateIdea, buildLandingPage } from './productDomain';
import { writeSeoContent, planCampaign } from './marketingDomain';
import { analyzeMetrics, processFeedback, planIteration } from './operationsDomain';
import { createCampaign, discoverAndQualify, resumeCampaignSending } from './campaignManager';
import { getProspectsByCampaign, getProspectsByStatus, listCampaigns, updateProspectStatus } from './prospectStore';
import { getPendingConnectionUrls, sendOutreachBatch } from './linkedinMessenger';
import {
    loadBusinessState,
    patchBusinessState,
    setLoopEnabled,
    appendTaskLog,
    updateTaskLog,
    getRecentCompletedTaskTypes,
} from './founderStore';
import {
    BusinessState,
    RoutedTask,
    TaskRecord,
    TaskOutput,
    TaskType,
    TaskStatus,
    LoopStatus,
    MRR_GOAL,
} from './founderTypes';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// ─── Loop state (in-memory) ───────────────────────────────────────────────────

let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopRunning = false;
let iterationsRun = 0;
let lastIterationAt: string | undefined;
let lastTaskType: string | undefined;
let lastTaskStatus: string | undefined;

// ─── Task Executor ────────────────────────────────────────────────────────────

const executeTask = async (task: RoutedTask, state: BusinessState): Promise<TaskOutput> => {
    switch (task.taskType) {
        case 'product.generate_idea':
            return generateIdea(state);

        case 'product.build_landing_page':
            return buildLandingPage(state);

        case 'marketing.write_seo_content':
            return writeSeoContent(state);

        case 'marketing.plan_campaign':
            return planCampaign(state);

        case 'sales.find_prospects': {
            // Create a campaign and run discovery + qualification + message generation only.
            // Sending is deferred to a separate sales.send_outreach iteration.
            const campaign = await createCampaign({
                name: `CEOClaw auto-campaign ${new Date().toISOString().split('T')[0]}`,
                searchQuery: process.env.CEOCLAW_DEFAULT_SEARCH_QUERY || 'CTO startup software',
                maxProspects: parsePositiveInt(process.env.CEOCLAW_MAX_PROSPECTS_PER_CAMPAIGN, 20),
                minFitScore: parsePositiveInt(process.env.CEOCLAW_MIN_FIT_SCORE, 65),
            });
            const result = await discoverAndQualify(campaign.campaignId);
            return {
                prospectsFound: result.prospectsDiscovered,
                campaignId: campaign.campaignId,
            };
        }

        case 'sales.send_outreach': {
            // Resume sending on the most recent paused/completed campaign that has message_ready prospects
            const campaigns = await listCampaigns();
            let resumable = null;
            for (const c of campaigns) {
                if (c.status !== 'completed' && c.status !== 'paused') continue;
                const prospects = await getProspectsByCampaign(c.campaignId);
                const hasReady = prospects.some((p) => p.status === 'message_ready');
                if (hasReady) { resumable = c; break; }
            }
            if (!resumable) {
                console.log('[FounderLoop] No campaigns with message_ready prospects — skipping send_outreach');
                return { messagesSent: 0, campaignId: 'none' };
            }
            const result = await resumeCampaignSending(resumable.campaignId);
            return {
                messagesSent: result.messagesSent,
                campaignId: resumable.campaignId,
            };
        }

        case 'sales.follow_up': {
            // 1. Fetch all prospects we sent connection requests to but haven't messaged yet
            const pendingProspects = await getProspectsByStatus('connection_sent');
            if (pendingProspects.length === 0) {
                console.log('[FounderLoop] No connection_sent prospects to follow up on.');
                return { acceptedConnections: 0, followUpsSent: 0 };
            }

            // 2. Scrape LinkedIn's sent-invitations page to see which requests are STILL pending
            let stillPendingUrls: string[];
            try {
                stillPendingUrls = await getPendingConnectionUrls();
            } catch (err: any) {
                console.warn(`[FounderLoop] Could not check pending connections: ${err.message}`);
                return { acceptedConnections: 0, followUpsSent: 0 };
            }

            const stillPendingSet = new Set(
                stillPendingUrls.map((u) => u.replace(/\/$/, '').toLowerCase())
            );

            // 3. Prospects NOT in the still-pending list have accepted the connection
            const accepted = pendingProspects.filter((p) => {
                const normalized = p.linkedinProfileUrl.replace(/\/$/, '').toLowerCase();
                return !stillPendingSet.has(normalized);
            });

            console.log(`[FounderLoop] ${accepted.length} connection(s) accepted out of ${pendingProspects.length} pending.`);

            if (accepted.length === 0) {
                return { acceptedConnections: 0, followUpsSent: 0 };
            }

            // 4. Send follow-up direct messages to newly connected prospects
            const followUpTargets = accepted.map((p) => ({
                prospectId: p.prospectId,
                profileUrl: p.linkedinProfileUrl,
                // Re-use the stored outreach message as the follow-up, or generate a brief thanks
                message: p.outreachMessage ||
                    `Hi ${p.firstName}, thanks for connecting! I'd love to show you how DevClaw can save your team hours on PRs. Happy to chat — any time this week work?`,
                firstName: p.firstName,
                connectionDegree: '1st' as const,  // they are now 1st-degree
            }));

            const results = await sendOutreachBatch(followUpTargets);
            const sent = results.filter((r) => r.sent).length;

            // 5. Update status in Supabase
            for (const result of results) {
                if (result.sent) {
                    await updateProspectStatus(result.prospectId, 'messaged', {
                        messagedAt: new Date().toISOString(),
                    });
                }
            }

            console.log(`[FounderLoop] Follow-up: sent ${sent}/${accepted.length} messages to newly connected prospects.`);
            return { acceptedConnections: accepted.length, followUpsSent: sent };
        }

        case 'operations.analyze_metrics':
            return analyzeMetrics(state);

        case 'operations.process_feedback':
            return processFeedback(state);

        case 'operations.plan_iteration':
            return planIteration(state);

        default: {
            const _exhaustive: never = task.taskType;
            throw new Error(`Unknown task type: ${_exhaustive}`);
        }
    }
};

// ─── State updater — applies task output to business state ───────────────────

const applyOutputToState = async (
    task: RoutedTask,
    output: TaskOutput,
    state: BusinessState
): Promise<void> => {
    const patch: Partial<BusinessState> = {
        tasksCompletedToday: state.tasksCompletedToday + 1,
        tasksCompletedTotal: state.tasksCompletedTotal + 1,
    };

    if (task.taskType === 'product.generate_idea') {
        const out = output as import('./founderTypes').ProductIdeaOutput;
        if (out.idea) patch.latestIdea = out.idea;
    }

    if (task.taskType === 'product.build_landing_page') {
        const out = output as import('./founderTypes').LandingPageOutput;
        if (out.html && !state.landingPageUrl) {
            // Mark phase as launched once landing page is built
            patch.phase = 'launched';
        }
    }

    if (task.taskType === 'marketing.write_seo_content') {
        const out = output as import('./founderTypes').SeoContentOutput;
        if (out.title) patch.latestContentTitle = out.title;
    }

    // Phase progression
    if (state.phase === 'launched' && state.totalSignups >= 10 && state.mrr > 0) {
        patch.phase = 'growth';
    }
    if (state.phase === 'growth' && state.mrr >= MRR_GOAL) {
        patch.phase = 'scaling';
        console.log(`\n🎉 [FounderLoop] $${MRR_GOAL} MRR MILESTONE ACHIEVED! Moving to scaling phase.\n`);
    }

    await patchBusinessState(patch);
};

// ─── Single Iteration ─────────────────────────────────────────────────────────

export const runOneIteration = async (): Promise<TaskRecord> => {
    console.log(`\n[FounderLoop] ─── Iteration #${iterationsRun + 1} starting ───`);

    const state = await loadBusinessState();
    const recentTasks = await getRecentCompletedTaskTypes(5);

    console.log(
        `[FounderLoop] State: MRR=$${state.mrr} signups=${state.totalSignups} ` +
        `traffic=${state.trafficLast30d} phase=${state.phase}`
    );

    // Route: ask OpenClaw what to do next
    const routed = await routeNextTask(state, recentTasks);

    const taskId = uuidv4();
    const startedAt = new Date().toISOString();
    const record: TaskRecord = {
        taskId,
        taskType: routed.taskType,
        domain: routed.domain,
        status: 'running',
        reason: routed.reason,
        priority: routed.priority,
        mrrAtTime: state.mrr,
        startedAt,
    };

    await appendTaskLog(record);
    lastTaskType = routed.taskType;
    lastTaskStatus = 'running';

    console.log(`[FounderLoop] Executing: ${routed.taskType} — "${routed.reason}"`);

    try {
        const output = await executeTask(routed, state);
        const completedAt = new Date().toISOString();

        await updateTaskLog(taskId, { status: 'completed', output, completedAt });
        await applyOutputToState(routed, output, state);

        lastTaskStatus = 'completed';
        iterationsRun++;
        lastIterationAt = completedAt;

        console.log(`[FounderLoop] ✅ ${routed.taskType} completed.`);

        return { ...record, status: 'completed', output, completedAt };
    } catch (err: any) {
        const completedAt = new Date().toISOString();
        await updateTaskLog(taskId, { status: 'failed', error: err.message, completedAt });
        // Still increment tasksCompletedToday even on failure (to avoid tight loops)
        await patchBusinessState({ tasksCompletedToday: state.tasksCompletedToday + 1 });

        lastTaskStatus = 'failed';
        lastIterationAt = completedAt;

        console.error(`[FounderLoop] ❌ ${routed.taskType} failed: ${err.message}`);
        return { ...record, status: 'failed', error: err.message, completedAt };
    }
};

// ─── Loop Scheduler ───────────────────────────────────────────────────────────

const scheduleNext = (): void => {
    if (!loopRunning) return;

    const intervalMs = parsePositiveInt(
        process.env.CEOCLAW_LOOP_INTERVAL_MS,
        60 * 60 * 1000 // 1 hour default
    );

    console.log(`[FounderLoop] Next iteration in ${Math.round(intervalMs / 60_000)} minutes.`);

    loopTimer = setTimeout(async () => {
        if (!loopRunning) return;
        try {
            await runOneIteration();
        } catch (err: any) {
            console.error('[FounderLoop] Unhandled iteration error:', err.message);
        }
        scheduleNext();
    }, intervalMs);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const startLoop = async (): Promise<void> => {
    if (loopRunning) {
        console.log('[FounderLoop] Already running.');
        return;
    }
    loopRunning = true;
    await setLoopEnabled(true);
    console.log('[FounderLoop] 🚀 Founder loop started.');

    // Run first iteration immediately
    try {
        await runOneIteration();
    } catch (err: any) {
        console.error('[FounderLoop] First iteration failed:', err.message);
    }

    scheduleNext();
};

export const stopLoop = async (): Promise<void> => {
    loopRunning = false;
    if (loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
    }
    await setLoopEnabled(false);
    console.log('[FounderLoop] ⏹ Founder loop stopped.');
};

export const getLoopStatus = async (): Promise<LoopStatus> => {
    const state = await loadBusinessState();
    const intervalMs = parsePositiveInt(
        process.env.CEOCLAW_LOOP_INTERVAL_MS,
        60 * 60 * 1000
    );
    const mrrPct = MRR_GOAL > 0 ? Math.round((state.mrr / MRR_GOAL) * 100) : 0;

    return {
        running: loopRunning,
        intervalMs,
        iterationsRun,
        lastIterationAt,
        lastTaskType: lastTaskType as TaskType | undefined,
        lastTaskStatus: lastTaskStatus as TaskStatus | undefined,
        currentMrr: state.mrr,
        mrrGoal: MRR_GOAL,
        mrrProgress: `${mrrPct}%`,
        phase: state.phase,
    };
};

// Auto-start if CEOCLAW_AUTO_START=true
if (process.env.CEOCLAW_AUTO_START === 'true') {
    startLoop().catch(console.error);
}
