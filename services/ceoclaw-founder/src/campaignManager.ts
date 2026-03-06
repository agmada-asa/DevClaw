/**
 * campaignManager.ts
 *
 * Orchestrates the full CEOClaw outreach pipeline for a single campaign:
 *
 *   1. DISCOVER  — Search LinkedIn for prospects matching the campaign query
 *   2. QUALIFY   — Use OpenClaw CLI (or llm-router direct) to score each prospect
 *   3. GENERATE  — Write a personalized outreach message for qualified prospects
 *   4. SEND      — Send connection requests / messages via Playwright
 *
 * Each stage writes progress to Supabase so runs can be resumed.
 * While a campaign runs, progress is also emitted to a JSON file.
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CampaignStatus, OutreachCampaign, ProspectRecord } from '@devclaw/contracts';
import { discoverProspects } from './linkedinProspector';
import { qualifyProspect, generateOutreachMessage } from './outreachCliAgent';
import { sendOutreachBatch, OutreachTarget } from './linkedinMessenger';
import {
    saveCampaign,
    getCampaign,
    saveProspect,
    updateProspectStatus,
    updateCampaignStatus,
    getProspectsByCampaign,
    isAlreadyProspected,
} from './prospectStore';

export interface CreateCampaignInput {
    name: string;
    searchQuery: string;
    targetIndustries?: string[];
    targetCompanySizes?: string[];
    targetTitles?: string[];
    maxProspects?: number;
    minFitScore?: number;
}

export interface CampaignRunOptions {
    discoveryTimeboxMs?: number;
    qualificationTimeboxMs?: number;
    messageTimeboxMs?: number;
    sendingTimeboxMs?: number;
}

export interface CampaignRunResult {
    campaignId: string;
    prospectsDiscovered: number;
    prospectsQualified: number;
    messagesGenerated: number;
    messagesSent: number;
    errors: string[];
    progressFile?: string;
}

interface DiscoveryStageResult {
    prospects: ProspectRecord[];
    timeboxHit: boolean;
}

interface QualificationStageResult {
    qualifiedProspects: ProspectRecord[];
    processedCount: number;
    qualifiedCount: number;
    disqualifiedCount: number;
    timeboxHit: boolean;
}

interface MessageStageResult {
    readyProspects: ProspectRecord[];
    generatedCount: number;
    processedCount: number;
    timeboxHit: boolean;
}

interface SendingStageResult {
    sentCount: number;
    attemptedCount: number;
    totalTargets: number;
    timeboxHit: boolean;
}

interface CampaignProspectSummary {
    total: number;
    discovered: number;
    qualified: number;
    disqualified: number;
    messageReady: number;
    connectionSent: number;
    messaged: number;
    replied: number;
}

type ProgressStage =
    | 'queued'
    | 'discovery'
    | 'qualification'
    | 'message_generation'
    | 'sending'
    | 'completed'
    | 'paused'
    | 'failed';

type StageKey = 'discovery' | 'qualification' | 'messageGeneration' | 'sending';
type StageStatus = 'pending' | 'running' | 'completed' | 'timeboxed' | 'skipped' | 'failed';

interface StageProgress {
    status: StageStatus;
    startedAt?: string;
    completedAt?: string;
    timeboxMs?: number;
    discovered?: number;
    processed?: number;
    qualified?: number;
    disqualified?: number;
    generated?: number;
    attempted?: number;
    sent?: number;
    note?: string;
}

interface CampaignProgressFile {
    campaignId: string;
    campaignName: string;
    mode: 'full' | 'discover_and_qualify';
    status: CampaignStatus | 'failed';
    currentStage: ProgressStage;
    currentlyDoing: string;
    runStartedAt: string;
    runCompletedAt?: string;
    updatedAt: string;
    progressFile: string;
    runOptions: CampaignRunOptions;
    counters: {
        prospectsDiscovered: number;
        prospectsQualified: number;
        messagesGenerated: number;
        messagesSent: number;
    };
    stages: {
        discovery: StageProgress;
        qualification: StageProgress;
        messageGeneration: StageProgress;
        sending: StageProgress;
    };
    results: {
        summary?: CampaignProspectSummary;
        errors: string[];
    };
    events: Array<{ at: string; stage: ProgressStage; message: string }>;
}

interface CampaignProgressTracker {
    filePath: string;
    startStage: (stage: StageKey, activity: string, timeboxMs?: number) => Promise<void>;
    finishStage: (stage: StageKey, status: StageStatus, note: string, patch?: Partial<StageProgress>) => Promise<void>;
    setActivity: (stage: ProgressStage, activity: string, trackEvent?: boolean) => Promise<void>;
    updateCounters: (patch: Partial<CampaignProgressFile['counters']>) => Promise<void>;
    addError: (message: string, stage?: ProgressStage) => Promise<void>;
    finishRun: (status: CampaignStatus | 'failed', stage: ProgressStage, message: string) => Promise<void>;
}

const nowIso = (): string => new Date().toISOString();

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
};

const withTimeout = async <T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race<T>([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const stageToProgressStage = (stage: StageKey): ProgressStage => (
    stage === 'messageGeneration' ? 'message_generation' : stage
);

const summarizeProspects = (prospects: ProspectRecord[]): CampaignProspectSummary => ({
    total: prospects.length,
    discovered: prospects.filter((p) => p.status === 'discovered').length,
    qualified: prospects.filter((p) => p.status === 'qualified').length,
    disqualified: prospects.filter((p) => p.status === 'disqualified').length,
    messageReady: prospects.filter((p) => p.status === 'message_ready').length,
    connectionSent: prospects.filter((p) => p.status === 'connection_sent').length,
    messaged: prospects.filter((p) => p.status === 'messaged').length,
    replied: prospects.filter((p) => p.status === 'replied').length,
});

const resolveRunOptions = (options: CampaignRunOptions = {}): CampaignRunOptions => {
    const resolvedDiscovery = parseOptionalPositiveInt(options.discoveryTimeboxMs)
        ?? parseOptionalPositiveInt(process.env.CEOCLAW_DISCOVERY_TIMEBOX_MS);
    const resolvedQualification = parseOptionalPositiveInt(options.qualificationTimeboxMs)
        ?? parseOptionalPositiveInt(process.env.CEOCLAW_QUALIFICATION_TIMEBOX_MS);
    const resolvedMessage = parseOptionalPositiveInt(options.messageTimeboxMs)
        ?? parseOptionalPositiveInt(process.env.CEOCLAW_MESSAGE_TIMEBOX_MS);
    const resolvedSending = parseOptionalPositiveInt(options.sendingTimeboxMs)
        ?? parseOptionalPositiveInt(process.env.CEOCLAW_SENDING_TIMEBOX_MS);

    return {
        ...(resolvedDiscovery !== undefined && { discoveryTimeboxMs: resolvedDiscovery }),
        ...(resolvedQualification !== undefined && { qualificationTimeboxMs: resolvedQualification }),
        ...(resolvedMessage !== undefined && { messageTimeboxMs: resolvedMessage }),
        ...(resolvedSending !== undefined && { sendingTimeboxMs: resolvedSending }),
    };
};

const defaultStageProgress = (): StageProgress => ({ status: 'pending' });

const getCampaignProgressDir = (): string => (
    process.env.CEOCLAW_PROGRESS_OUTPUT_DIR
    || path.join(
        process.env.CEOCLAW_OUTPUT_DIR || path.join(process.cwd(), 'ceoclaw-output'),
        'campaign-progress'
    )
);

export const getCampaignProgressPath = (campaignId: string): string => {
    return path.resolve(getCampaignProgressDir(), `campaign-${campaignId}.json`);
};

const createProgressTracker = async (
    campaign: OutreachCampaign,
    mode: 'full' | 'discover_and_qualify',
    runOptions: CampaignRunOptions
): Promise<CampaignProgressTracker> => {
    const filePath = getCampaignProgressPath(campaign.campaignId);
    const snapshot: CampaignProgressFile = {
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        mode,
        status: 'running',
        currentStage: 'queued',
        currentlyDoing: 'Campaign run queued.',
        runStartedAt: nowIso(),
        updatedAt: nowIso(),
        progressFile: filePath,
        runOptions,
        counters: {
            prospectsDiscovered: 0,
            prospectsQualified: 0,
            messagesGenerated: 0,
            messagesSent: 0,
        },
        stages: {
            discovery: defaultStageProgress(),
            qualification: defaultStageProgress(),
            messageGeneration: defaultStageProgress(),
            sending: defaultStageProgress(),
        },
        results: {
            errors: [],
        },
        events: [],
    };

    const pushEvent = (stage: ProgressStage, message: string): void => {
        snapshot.events.push({ at: nowIso(), stage, message });
        if (snapshot.events.length > 250) snapshot.events.shift();
    };

    const refreshSummary = async (): Promise<void> => {
        try {
            const prospects = await getProspectsByCampaign(campaign.campaignId);
            const safeProspects = Array.isArray(prospects) ? prospects : [];
            snapshot.results.summary = summarizeProspects(safeProspects);
        } catch (err: any) {
            console.warn(`[CampaignManager] Could not refresh campaign summary for progress JSON: ${err.message}`);
        }
    };

    const persist = async (): Promise<void> => {
        snapshot.updatedAt = nowIso();
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
        } catch (err: any) {
            console.warn(`[CampaignManager] Could not write progress JSON (${filePath}): ${err.message}`);
        }
    };

    await refreshSummary();
    await persist();

    return {
        filePath,

        startStage: async (stage, activity, timeboxMs) => {
            const stageSnapshot = snapshot.stages[stage];
            stageSnapshot.status = 'running';
            stageSnapshot.startedAt = stageSnapshot.startedAt || nowIso();
            if (timeboxMs !== undefined) stageSnapshot.timeboxMs = timeboxMs;

            snapshot.currentStage = stageToProgressStage(stage);
            snapshot.currentlyDoing = activity;
            pushEvent(snapshot.currentStage, activity);

            await persist();
        },

        finishStage: async (stage, status, note, patch) => {
            const stageSnapshot = snapshot.stages[stage];
            stageSnapshot.status = status;
            stageSnapshot.completedAt = nowIso();
            if (patch) Object.assign(stageSnapshot, patch);
            stageSnapshot.note = note;

            snapshot.currentStage = stageToProgressStage(stage);
            snapshot.currentlyDoing = note;
            pushEvent(snapshot.currentStage, note);

            await refreshSummary();
            await persist();
        },

        setActivity: async (stage, activity, trackEvent = false) => {
            snapshot.currentStage = stage;
            snapshot.currentlyDoing = activity;
            if (trackEvent) pushEvent(stage, activity);
            await persist();
        },

        updateCounters: async (patch) => {
            snapshot.counters = { ...snapshot.counters, ...patch };
            await persist();
        },

        addError: async (message, stage = 'failed') => {
            snapshot.results.errors.push(message);
            pushEvent(stage, `ERROR: ${message}`);
            await persist();
        },

        finishRun: async (status, stage, message) => {
            snapshot.status = status;
            snapshot.currentStage = stage;
            snapshot.currentlyDoing = message;
            snapshot.runCompletedAt = nowIso();
            pushEvent(stage, message);
            await refreshSummary();
            await persist();
        },
    };
};

// ─── Campaign Lifecycle ───────────────────────────────────────────────────────

export const createCampaign = async (input: CreateCampaignInput): Promise<OutreachCampaign> => {
    const now = nowIso();
    const campaign: OutreachCampaign = {
        campaignId: uuidv4(),
        name: input.name,
        searchQuery: input.searchQuery,
        targetIndustries: input.targetIndustries || [],
        targetCompanySizes: input.targetCompanySizes || [],
        targetTitles: input.targetTitles || [],
        maxProspects: input.maxProspects || 50,
        minFitScore: input.minFitScore || 60,
        status: 'draft',
        prospectsFound: 0,
        prospectsQualified: 0,
        messagesGenerated: 0,
        messagesSent: 0,
        replies: 0,
        createdAt: now,
        updatedAt: now,
    };

    await saveCampaign(campaign);
    console.log(`[CampaignManager] Created campaign ${campaign.campaignId}: "${campaign.name}"`);
    return campaign;
};

// ─── Stage 1: Discovery ───────────────────────────────────────────────────────

const runDiscovery = async (
    campaign: OutreachCampaign,
    errors: string[],
    options: CampaignRunOptions,
    tracker?: CampaignProgressTracker
): Promise<DiscoveryStageResult> => {
    const delayMs = parseInt(process.env.CEOCLAW_DELAY_BETWEEN_ACTIONS_MS || '3000', 10);

    console.log(`[CampaignManager] [${campaign.campaignId}] Stage 1: Discovering prospects...`);

    let rawProspects;
    let timeboxHit = false;
    try {
        rawProspects = await discoverProspects({
            query: campaign.searchQuery,
            maxResults: campaign.maxProspects,
            delayBetweenActionsMs: delayMs,
            maxDurationMs: options.discoveryTimeboxMs,
            onProgress: async (progress) => {
                if (progress.timeboxReached) timeboxHit = true;
                if (tracker) {
                    await tracker.setActivity(
                        'discovery',
                        `Discovering prospects: page ${Math.min(progress.page, progress.maxPages)}/${progress.maxPages}, ` +
                        `${progress.found}/${progress.maxResults} found`
                    );
                }
            },
        });
    } catch (err: any) {
        const message = `Discovery failed: ${err.message}`;
        errors.push(message);
        throw new Error(message);
    }

    const now = nowIso();
    const prospects: ProspectRecord[] = [];

    for (const raw of rawProspects) {
        const alreadyExists = await isAlreadyProspected(campaign.campaignId, raw.linkedinProfileUrl);
        if (alreadyExists) {
            console.log(`[CampaignManager] Skipping already-prospected: ${raw.linkedinProfileUrl}`);
            continue;
        }

        const record: ProspectRecord = {
            prospectId: uuidv4(),
            campaignId: campaign.campaignId,
            linkedinProfileUrl: raw.linkedinProfileUrl,
            linkedinCompanyUrl: raw.linkedinCompanyUrl,
            firstName: raw.firstName,
            lastName: raw.lastName,
            title: raw.title,
            companyName: raw.companyName,
            companySize: raw.companySize,
            industry: raw.industry,
            location: raw.location,
            status: 'discovered',
            createdAt: now,
            updatedAt: now,
        };

        await saveProspect(record);
        prospects.push(record);
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { prospectsFound: prospects.length });
    if (timeboxHit) {
        console.log(
            `[CampaignManager] [${campaign.campaignId}] Discovery stopped due to timebox ` +
            `after finding ${prospects.length} prospects.`
        );
    } else {
        console.log(`[CampaignManager] [${campaign.campaignId}] Discovered ${prospects.length} new prospects.`);
    }

    return { prospects, timeboxHit };
};

// ─── Stage 2: Qualification ───────────────────────────────────────────────────

const runQualification = async (
    campaign: OutreachCampaign,
    prospects: ProspectRecord[],
    errors: string[],
    options: CampaignRunOptions,
    tracker?: CampaignProgressTracker
): Promise<QualificationStageResult> => {
    const perProspectTimeoutMs = parsePositiveInt(process.env.CEOCLAW_QUALIFY_TIMEOUT_MS, 90_000);
    const stageDeadline = options.qualificationTimeboxMs
        ? Date.now() + options.qualificationTimeboxMs
        : null;

    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 2: Qualifying ${prospects.length} prospects ` +
        `(minFitScore=${campaign.minFitScore})...`
    );

    const qualified: ProspectRecord[] = [];
    let qualifiedCount = 0;
    let disqualifiedCount = 0;
    let processedCount = 0;
    let timeboxHit = false;

    for (let index = 0; index < prospects.length; index++) {
        if (stageDeadline !== null && Date.now() >= stageDeadline) {
            timeboxHit = true;
            console.log(
                `[CampaignManager] [${campaign.campaignId}] Qualification timebox reached ` +
                `after processing ${processedCount}/${prospects.length} prospects.`
            );
            break;
        }

        const prospect = prospects[index];
        const remainingTimeMs = stageDeadline !== null
            ? Math.max(0, stageDeadline - Date.now())
            : undefined;
        const timeoutMs = remainingTimeMs !== undefined
            ? Math.max(1, Math.min(perProspectTimeoutMs, remainingTimeMs))
            : perProspectTimeoutMs;

        if (tracker) {
            await tracker.setActivity(
                'qualification',
                `Qualifying prospect ${index + 1}/${prospects.length}: ${prospect.firstName} ${prospect.lastName}`
            );
        }

        try {
            const result = await withTimeout(
                qualifyProspect({
                    prospectId: prospect.prospectId,
                    firstName: prospect.firstName,
                    lastName: prospect.lastName,
                    title: prospect.title,
                    companyName: prospect.companyName,
                    industry: prospect.industry,
                    companySize: prospect.companySize,
                    location: prospect.location,
                }),
                timeoutMs,
                `Qualification for ${prospect.prospectId}`
            );

            processedCount++;

            if (result.qualified && result.fitScore >= campaign.minFitScore) {
                await updateProspectStatus(prospect.prospectId, 'qualified', {
                    fitScore: result.fitScore,
                    fitReason: result.fitReason,
                });
                qualified.push({ ...prospect, fitScore: result.fitScore, fitReason: result.fitReason, status: 'qualified' });
                qualifiedCount++;
                await updateCampaignStatus(campaign.campaignId, 'running', { prospectsQualified: qualifiedCount });
                console.log(
                    `[CampaignManager] ✅ Qualified: ${prospect.firstName} ${prospect.lastName} ` +
                    `@ ${prospect.companyName} (score=${result.fitScore})`
                );
            } else {
                await updateProspectStatus(prospect.prospectId, 'disqualified', {
                    fitScore: result.fitScore,
                    fitReason: result.fitReason,
                });
                disqualifiedCount++;
                console.log(
                    `[CampaignManager] ❌ Disqualified: ${prospect.firstName} ${prospect.lastName} ` +
                    `@ ${prospect.companyName} (score=${result.fitScore}, reason=${result.fitReason})`
                );
            }
        } catch (err: any) {
            const stageTimedOut = stageDeadline !== null && Date.now() >= stageDeadline && /timed out/i.test(err.message || '');
            if (stageTimedOut) {
                timeboxHit = true;
                console.log(
                    `[CampaignManager] [${campaign.campaignId}] Qualification timebox reached ` +
                    `during prospect ${index + 1}/${prospects.length}.`
                );
                break;
            }

            processedCount++;
            errors.push(`Qualification failed for ${prospect.prospectId}: ${err.message}`);
            console.error(`[CampaignManager] Qualification error for ${prospect.prospectId}:`, err.message);
        }
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { prospectsQualified: qualifiedCount });
    console.log(
        `[CampaignManager] [${campaign.campaignId}] ${qualifiedCount}/${processedCount} processed prospects qualified.`
    );

    return {
        qualifiedProspects: qualified,
        processedCount,
        qualifiedCount,
        disqualifiedCount,
        timeboxHit,
    };
};

// ─── Stage 3: Message Generation ─────────────────────────────────────────────

const runMessageGeneration = async (
    campaign: OutreachCampaign,
    qualified: ProspectRecord[],
    errors: string[],
    options: CampaignRunOptions,
    tracker?: CampaignProgressTracker
): Promise<MessageStageResult> => {
    const perProspectTimeoutMs = parsePositiveInt(process.env.CEOCLAW_MESSAGE_TIMEOUT_MS, 90_000);
    const stageDeadline = options.messageTimeboxMs
        ? Date.now() + options.messageTimeboxMs
        : null;

    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 3: Generating messages for ${qualified.length} prospects...`
    );

    const ready: ProspectRecord[] = [];
    let generatedCount = 0;
    let processedCount = 0;
    let timeboxHit = false;

    for (let index = 0; index < qualified.length; index++) {
        if (stageDeadline !== null && Date.now() >= stageDeadline) {
            timeboxHit = true;
            console.log(
                `[CampaignManager] [${campaign.campaignId}] Message generation timebox reached ` +
                `after processing ${processedCount}/${qualified.length} prospects.`
            );
            break;
        }

        const prospect = qualified[index];
        const remainingTimeMs = stageDeadline !== null
            ? Math.max(0, stageDeadline - Date.now())
            : undefined;
        const timeoutMs = remainingTimeMs !== undefined
            ? Math.max(1, Math.min(perProspectTimeoutMs, remainingTimeMs))
            : perProspectTimeoutMs;

        if (tracker) {
            await tracker.setActivity(
                'message_generation',
                `Generating message ${index + 1}/${qualified.length}: ${prospect.firstName} ${prospect.lastName}`
            );
        }

        try {
            const result = await withTimeout(
                generateOutreachMessage({
                    prospectId: prospect.prospectId,
                    firstName: prospect.firstName,
                    lastName: prospect.lastName,
                    title: prospect.title,
                    companyName: prospect.companyName,
                    industry: prospect.industry,
                    companySize: prospect.companySize,
                    fitReason: prospect.fitReason,
                }),
                timeoutMs,
                `Message generation for ${prospect.prospectId}`
            );
            processedCount++;

            await updateProspectStatus(prospect.prospectId, 'message_ready', {
                outreachMessage: result.message,
            });

            ready.push({ ...prospect, outreachMessage: result.message, status: 'message_ready' });
            generatedCount++;
            await updateCampaignStatus(campaign.campaignId, 'running', { messagesGenerated: generatedCount });
            console.log(
                `[CampaignManager] Message ready for ${prospect.firstName} ${prospect.lastName}: ` +
                `"${result.message.slice(0, 60)}..."`
            );
        } catch (err: any) {
            const stageTimedOut = stageDeadline !== null && Date.now() >= stageDeadline && /timed out/i.test(err.message || '');
            if (stageTimedOut) {
                timeboxHit = true;
                console.log(
                    `[CampaignManager] [${campaign.campaignId}] Message generation timebox reached ` +
                    `during prospect ${index + 1}/${qualified.length}.`
                );
                break;
            }

            processedCount++;
            errors.push(`Message generation failed for ${prospect.prospectId}: ${err.message}`);
            console.error(`[CampaignManager] Message generation error for ${prospect.prospectId}:`, err.message);
        }
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { messagesGenerated: generatedCount });
    console.log(`[CampaignManager] [${campaign.campaignId}] ${generatedCount} messages generated.`);
    return {
        readyProspects: ready,
        generatedCount,
        processedCount,
        timeboxHit,
    };
};

// ─── Stage 4: Outreach Sending ────────────────────────────────────────────────

const runOutreachSending = async (
    campaign: OutreachCampaign,
    readyProspects: ProspectRecord[],
    errors: string[],
    options: CampaignRunOptions,
): Promise<SendingStageResult> => {
    if (readyProspects.length === 0) {
        return { sentCount: 0, attemptedCount: 0, totalTargets: 0, timeboxHit: false };
    }

    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 4: Sending ${readyProspects.length} messages...`
    );

    const targets: OutreachTarget[] = readyProspects
        .filter((p) => p.outreachMessage)
        .map((p) => ({
            prospectId: p.prospectId,
            profileUrl: p.linkedinProfileUrl,
            message: p.outreachMessage!,
            firstName: p.firstName,
            lastName: p.lastName,
        }));

    if (targets.length === 0) {
        return { sentCount: 0, attemptedCount: 0, totalTargets: 0, timeboxHit: false };
    }

    const results = await sendOutreachBatch(targets, {
        maxDurationMs: options.sendingTimeboxMs,
    });
    const attemptedCount = results.length;
    const timeboxHit = options.sendingTimeboxMs !== undefined && attemptedCount < targets.length;
    let sentCount = 0;

    for (const result of results) {
        if (result.sent) {
            const method = result.method === 'direct_message' ? 'messaged' : 'connection_sent';
            const now = nowIso();
            await updateProspectStatus(result.prospectId, method as any, {
                connectionSentAt: method === 'connection_sent' ? now : undefined,
                messagedAt: method === 'messaged' ? now : undefined,
            });
            sentCount++;
        } else {
            if (result.error) errors.push(`Send failed for ${result.prospectId}: ${result.error}`);
        }
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { messagesSent: sentCount });
    if (timeboxHit) {
        console.log(
            `[CampaignManager] [${campaign.campaignId}] Sending timebox reached after ` +
            `${attemptedCount}/${targets.length} attempts (${sentCount} sent).`
        );
    } else {
        console.log(`[CampaignManager] [${campaign.campaignId}] ${sentCount}/${targets.length} messages sent.`);
    }
    return { sentCount, attemptedCount, totalTargets: targets.length, timeboxHit };
};

// ─── Discovery + Qualification only (no sending) ─────────────────────────────
// Used by the founder loop 'sales.find_prospects' task so that sending is
// always deferred to a separate 'sales.send_outreach' iteration.

export const discoverAndQualify = async (
    campaignId: string,
    options: CampaignRunOptions = {}
): Promise<CampaignRunResult> => {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (campaign.status === 'running') throw new Error(`Campaign ${campaignId} is already running`);

    const resolvedOptions = resolveRunOptions(options);
    const tracker = await createProgressTracker(campaign, 'discover_and_qualify', resolvedOptions);
    const errors: string[] = [];
    await updateCampaignStatus(campaignId, 'running');

    try {
        await tracker.startStage(
            'discovery',
            `Discovering prospects for query "${campaign.searchQuery}"`,
            resolvedOptions.discoveryTimeboxMs
        );
        const discovery = await runDiscovery(campaign, errors, resolvedOptions, tracker);
        await tracker.updateCounters({ prospectsDiscovered: discovery.prospects.length });
        await tracker.finishStage(
            'discovery',
            discovery.timeboxHit ? 'timeboxed' : 'completed',
            discovery.timeboxHit
                ? `Discovery timebox reached after ${discovery.prospects.length} prospects.`
                : `Discovery complete: ${discovery.prospects.length} prospects.`,
            { discovered: discovery.prospects.length, processed: discovery.prospects.length }
        );

        await tracker.startStage(
            'qualification',
            'Qualifying discovered prospects against ICP.',
            resolvedOptions.qualificationTimeboxMs
        );
        const qualification = await runQualification(
            campaign,
            discovery.prospects,
            errors,
            resolvedOptions,
            tracker
        );
        await tracker.updateCounters({ prospectsQualified: qualification.qualifiedCount });
        await tracker.finishStage(
            'qualification',
            qualification.timeboxHit ? 'timeboxed' : 'completed',
            qualification.timeboxHit
                ? `Qualification timebox reached after ${qualification.processedCount} prospects.`
                : `Qualification complete: ${qualification.qualifiedCount} qualified.`,
            {
                processed: qualification.processedCount,
                qualified: qualification.qualifiedCount,
                disqualified: qualification.disqualifiedCount,
            }
        );

        let messageGenerationCount = 0;
        if (qualification.qualifiedProspects.length > 0) {
            await tracker.startStage(
                'messageGeneration',
                'Generating personalized outreach messages.',
                resolvedOptions.messageTimeboxMs
            );
            const messageGeneration = await runMessageGeneration(
                campaign,
                qualification.qualifiedProspects,
                errors,
                resolvedOptions,
                tracker
            );
            messageGenerationCount = messageGeneration.generatedCount;
            await tracker.updateCounters({ messagesGenerated: messageGeneration.generatedCount });
            await tracker.finishStage(
                'messageGeneration',
                messageGeneration.timeboxHit ? 'timeboxed' : 'completed',
                messageGeneration.timeboxHit
                    ? `Message generation timebox reached: ${messageGeneration.generatedCount} ready.`
                    : `Message generation complete: ${messageGeneration.generatedCount} ready.`,
                { generated: messageGeneration.generatedCount, processed: messageGeneration.processedCount }
            );
        } else {
            await tracker.finishStage(
                'messageGeneration',
                'skipped',
                'Skipped message generation: no qualified prospects.',
                { generated: 0, processed: 0 }
            );
        }

        await tracker.finishStage(
            'sending',
            'skipped',
            'Sending deferred: campaign paused after discovery and qualification.',
            { attempted: 0, sent: 0 }
        );

        // Leave campaign paused — ready for send_outreach to pick up
        await updateCampaignStatus(campaignId, 'paused');
        await tracker.finishRun(
            'paused',
            'completed',
            'Discovery + qualification run complete. Campaign paused awaiting send.'
        );

        console.log(
            `[CampaignManager] discoverAndQualify ${campaignId}: ` +
            `discovered=${discovery.prospects.length} qualified=${qualification.qualifiedCount} ` +
            `message_ready=${messageGenerationCount}`
        );

        return {
            campaignId,
            prospectsDiscovered: discovery.prospects.length,
            prospectsQualified: qualification.qualifiedCount,
            messagesGenerated: messageGenerationCount,
            messagesSent: 0,
            errors,
            progressFile: tracker.filePath,
        };
    } catch (err: any) {
        await updateCampaignStatus(campaignId, 'paused');
        await tracker.addError(err.message, 'failed');
        await tracker.finishRun('failed', 'failed', `Run failed: ${err.message}`);
        throw err;
    }
};

// ─── Full Pipeline Run ────────────────────────────────────────────────────────

export const runCampaign = async (
    campaignId: string,
    options: CampaignRunOptions = {}
): Promise<CampaignRunResult> => {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (campaign.status === 'running') {
        throw new Error(`Campaign ${campaignId} is already running`);
    }
    if (campaign.status === 'completed') {
        throw new Error(`Campaign ${campaignId} is already completed`);
    }

    const resolvedOptions = resolveRunOptions(options);
    const tracker = await createProgressTracker(campaign, 'full', resolvedOptions);
    const errors: string[] = [];
    await updateCampaignStatus(campaignId, 'running');

    try {
        // Stage 1: Discovery
        await tracker.startStage(
            'discovery',
            `Discovering prospects for query "${campaign.searchQuery}"`,
            resolvedOptions.discoveryTimeboxMs
        );
        const discovery = await runDiscovery(campaign, errors, resolvedOptions, tracker);
        await tracker.updateCounters({ prospectsDiscovered: discovery.prospects.length });
        await tracker.finishStage(
            'discovery',
            discovery.timeboxHit ? 'timeboxed' : 'completed',
            discovery.timeboxHit
                ? `Discovery timebox reached after ${discovery.prospects.length} prospects.`
                : `Discovery complete: ${discovery.prospects.length} prospects.`,
            { discovered: discovery.prospects.length, processed: discovery.prospects.length }
        );

        // Stage 2: Qualification
        await tracker.startStage(
            'qualification',
            'Qualifying discovered prospects against ICP.',
            resolvedOptions.qualificationTimeboxMs
        );
        const qualification = await runQualification(
            campaign,
            discovery.prospects,
            errors,
            resolvedOptions,
            tracker
        );
        await tracker.updateCounters({ prospectsQualified: qualification.qualifiedCount });
        await tracker.finishStage(
            'qualification',
            qualification.timeboxHit ? 'timeboxed' : 'completed',
            qualification.timeboxHit
                ? `Qualification timebox reached after ${qualification.processedCount} prospects.`
                : `Qualification complete: ${qualification.qualifiedCount} qualified.`,
            {
                processed: qualification.processedCount,
                qualified: qualification.qualifiedCount,
                disqualified: qualification.disqualifiedCount,
            }
        );

        // Stage 3: Message generation
        let messageGeneration: MessageStageResult = {
            readyProspects: [],
            generatedCount: 0,
            processedCount: 0,
            timeboxHit: false,
        };
        if (qualification.qualifiedProspects.length > 0) {
            await tracker.startStage(
                'messageGeneration',
                'Generating personalized outreach messages.',
                resolvedOptions.messageTimeboxMs
            );
            messageGeneration = await runMessageGeneration(
                campaign,
                qualification.qualifiedProspects,
                errors,
                resolvedOptions,
                tracker
            );
            await tracker.updateCounters({ messagesGenerated: messageGeneration.generatedCount });
            await tracker.finishStage(
                'messageGeneration',
                messageGeneration.timeboxHit ? 'timeboxed' : 'completed',
                messageGeneration.timeboxHit
                    ? `Message generation timebox reached: ${messageGeneration.generatedCount} ready.`
                    : `Message generation complete: ${messageGeneration.generatedCount} ready.`,
                { generated: messageGeneration.generatedCount, processed: messageGeneration.processedCount }
            );
        } else {
            await tracker.finishStage(
                'messageGeneration',
                'skipped',
                'Skipped message generation: no qualified prospects.',
                { generated: 0, processed: 0 }
            );
        }

        // Stage 4: Send outreach
        let sending: SendingStageResult = {
            sentCount: 0,
            attemptedCount: 0,
            totalTargets: 0,
            timeboxHit: false,
        };
        if (messageGeneration.readyProspects.length > 0) {
            await tracker.startStage(
                'sending',
                `Sending outreach to ${messageGeneration.readyProspects.length} message-ready prospects.`,
                resolvedOptions.sendingTimeboxMs
            );
            sending = await runOutreachSending(
                campaign,
                messageGeneration.readyProspects,
                errors,
                resolvedOptions
            );
            await tracker.updateCounters({ messagesSent: sending.sentCount });
            await tracker.finishStage(
                'sending',
                sending.timeboxHit ? 'timeboxed' : 'completed',
                sending.timeboxHit
                    ? `Sending timebox reached: ${sending.sentCount}/${sending.totalTargets} sent.`
                    : `Sending complete: ${sending.sentCount}/${sending.attemptedCount} sent.`,
                { attempted: sending.attemptedCount, sent: sending.sentCount, processed: sending.attemptedCount }
            );
        } else {
            await tracker.finishStage(
                'sending',
                'skipped',
                'Skipped sending: no message-ready prospects.',
                { attempted: 0, sent: 0, processed: 0 }
            );
        }

        const partialTimebox = messageGeneration.timeboxHit || sending.timeboxHit;
        if (partialTimebox) {
            await updateCampaignStatus(campaignId, 'paused');
            await tracker.finishRun(
                'paused',
                'paused',
                'Campaign paused: message generation or sending timebox reached.'
            );
        } else {
            await updateCampaignStatus(campaignId, 'completed');
            await tracker.finishRun('completed', 'completed', 'Campaign run completed.');
        }

        console.log(
            `[CampaignManager] Campaign ${campaignId} ${partialTimebox ? 'paused' : 'completed'}: ` +
            `discovered=${discovery.prospects.length} qualified=${qualification.qualifiedCount} ` +
            `messages=${messageGeneration.generatedCount} sent=${sending.sentCount}`
        );

        return {
            campaignId,
            prospectsDiscovered: discovery.prospects.length,
            prospectsQualified: qualification.qualifiedCount,
            messagesGenerated: messageGeneration.generatedCount,
            messagesSent: sending.sentCount,
            errors,
            progressFile: tracker.filePath,
        };
    } catch (err: any) {
        await updateCampaignStatus(campaignId, 'paused');
        await tracker.addError(err.message, 'failed');
        await tracker.finishRun('failed', 'failed', `Run failed: ${err.message}`);
        throw err;
    }
};

// ─── Resume: re-run from message_ready prospects ──────────────────────────────

export const resumeCampaignSending = async (campaignId: string): Promise<CampaignRunResult> => {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const tracker = await createProgressTracker(campaign, 'full', {});
    const allProspects = await getProspectsByCampaign(campaignId);
    const readyProspects = allProspects.filter((p) => p.status === 'message_ready');
    const errors: string[] = [];

    await tracker.finishStage('discovery', 'skipped', 'Resume run: discovery already completed.');
    await tracker.finishStage('qualification', 'skipped', 'Resume run: qualification already completed.');
    await tracker.finishStage('messageGeneration', 'skipped', 'Resume run: message generation already completed.');

    if (readyProspects.length === 0) {
        await tracker.finishStage('sending', 'skipped', 'Resume run: no message-ready prospects available.', { attempted: 0, sent: 0 });
        await tracker.finishRun('completed', 'completed', 'Resume run completed with no sends.');
        return {
            campaignId,
            prospectsDiscovered: allProspects.length,
            prospectsQualified: allProspects.filter((p) => p.status !== 'disqualified').length,
            messagesGenerated: 0,
            messagesSent: 0,
            errors: [],
            progressFile: tracker.filePath,
        };
    }

    await tracker.startStage('sending', `Resuming outreach for ${readyProspects.length} message-ready prospects.`);
    const sending = await runOutreachSending(campaign, readyProspects, errors, {});
    await tracker.updateCounters({ messagesSent: sending.sentCount });
    await tracker.finishStage(
        'sending',
        'completed',
        `Resume sending complete: ${sending.sentCount}/${sending.attemptedCount} sent.`,
        { attempted: sending.attemptedCount, sent: sending.sentCount, processed: sending.attemptedCount }
    );
    await updateCampaignStatus(campaignId, 'completed');
    await tracker.finishRun('completed', 'completed', 'Resume run completed.');

    return {
        campaignId,
        prospectsDiscovered: allProspects.length,
        prospectsQualified: allProspects.filter((p) => p.status !== 'disqualified').length,
        messagesGenerated: readyProspects.length,
        messagesSent: sending.sentCount,
        errors,
        progressFile: tracker.filePath,
    };
};
