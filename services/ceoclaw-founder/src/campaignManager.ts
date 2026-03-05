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
 */

import { v4 as uuidv4 } from 'uuid';
import { OutreachCampaign, ProspectRecord } from '@devclaw/contracts';
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

export interface CampaignRunResult {
    campaignId: string;
    prospectsDiscovered: number;
    prospectsQualified: number;
    messagesGenerated: number;
    messagesSent: number;
    errors: string[];
}

// ─── Campaign Lifecycle ───────────────────────────────────────────────────────

export const createCampaign = async (input: CreateCampaignInput): Promise<OutreachCampaign> => {
    const now = new Date().toISOString();
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
    errors: string[]
): Promise<ProspectRecord[]> => {
    const delayMs = parseInt(process.env.CEOCLAW_DELAY_BETWEEN_ACTIONS_MS || '3000', 10);

    console.log(`[CampaignManager] [${campaign.campaignId}] Stage 1: Discovering prospects...`);

    let rawProspects;
    try {
        rawProspects = await discoverProspects({
            query: campaign.searchQuery,
            maxResults: campaign.maxProspects,
            delayBetweenActionsMs: delayMs,
        });
    } catch (err: any) {
        errors.push(`Discovery failed: ${err.message}`);
        return [];
    }

    const now = new Date().toISOString();
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
    console.log(`[CampaignManager] [${campaign.campaignId}] Discovered ${prospects.length} new prospects.`);
    return prospects;
};

// ─── Stage 2: Qualification ───────────────────────────────────────────────────

const runQualification = async (
    campaign: OutreachCampaign,
    prospects: ProspectRecord[],
    errors: string[]
): Promise<ProspectRecord[]> => {
    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 2: Qualifying ${prospects.length} prospects ` +
        `(minFitScore=${campaign.minFitScore})...`
    );

    const qualified: ProspectRecord[] = [];
    let qualifiedCount = 0;

    for (const prospect of prospects) {
        try {
            const result = await qualifyProspect({
                prospectId: prospect.prospectId,
                firstName: prospect.firstName,
                lastName: prospect.lastName,
                title: prospect.title,
                companyName: prospect.companyName,
                industry: prospect.industry,
                companySize: prospect.companySize,
                location: prospect.location,
            });

            if (result.qualified && result.fitScore >= campaign.minFitScore) {
                await updateProspectStatus(prospect.prospectId, 'qualified', {
                    fitScore: result.fitScore,
                    fitReason: result.fitReason,
                });
                qualified.push({ ...prospect, fitScore: result.fitScore, fitReason: result.fitReason, status: 'qualified' });
                qualifiedCount++;
                console.log(
                    `[CampaignManager] ✅ Qualified: ${prospect.firstName} ${prospect.lastName} ` +
                    `@ ${prospect.companyName} (score=${result.fitScore})`
                );
            } else {
                await updateProspectStatus(prospect.prospectId, 'disqualified', {
                    fitScore: result.fitScore,
                    fitReason: result.fitReason,
                });
                console.log(
                    `[CampaignManager] ❌ Disqualified: ${prospect.firstName} ${prospect.lastName} ` +
                    `@ ${prospect.companyName} (score=${result.fitScore}, reason=${result.fitReason})`
                );
            }
        } catch (err: any) {
            errors.push(`Qualification failed for ${prospect.prospectId}: ${err.message}`);
            console.error(`[CampaignManager] Qualification error for ${prospect.prospectId}:`, err.message);
        }
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { prospectsQualified: qualifiedCount });
    console.log(`[CampaignManager] [${campaign.campaignId}] ${qualifiedCount}/${prospects.length} prospects qualified.`);
    return qualified;
};

// ─── Stage 3: Message Generation ─────────────────────────────────────────────

const runMessageGeneration = async (
    campaign: OutreachCampaign,
    qualified: ProspectRecord[],
    errors: string[]
): Promise<ProspectRecord[]> => {
    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 3: Generating messages for ${qualified.length} prospects...`
    );

    const ready: ProspectRecord[] = [];
    let generatedCount = 0;

    for (const prospect of qualified) {
        try {
            const result = await generateOutreachMessage({
                prospectId: prospect.prospectId,
                firstName: prospect.firstName,
                lastName: prospect.lastName,
                title: prospect.title,
                companyName: prospect.companyName,
                industry: prospect.industry,
                companySize: prospect.companySize,
                fitReason: prospect.fitReason,
            });

            await updateProspectStatus(prospect.prospectId, 'message_ready', {
                outreachMessage: result.message,
            });

            ready.push({ ...prospect, outreachMessage: result.message, status: 'message_ready' });
            generatedCount++;
            console.log(
                `[CampaignManager] Message ready for ${prospect.firstName} ${prospect.lastName}: ` +
                `"${result.message.slice(0, 60)}..."`
            );
        } catch (err: any) {
            errors.push(`Message generation failed for ${prospect.prospectId}: ${err.message}`);
            console.error(`[CampaignManager] Message generation error for ${prospect.prospectId}:`, err.message);
        }
    }

    await updateCampaignStatus(campaign.campaignId, 'running', { messagesGenerated: generatedCount });
    console.log(`[CampaignManager] [${campaign.campaignId}] ${generatedCount} messages generated.`);
    return ready;
};

// ─── Stage 4: Outreach Sending ────────────────────────────────────────────────

const runOutreachSending = async (
    campaign: OutreachCampaign,
    readyProspects: ProspectRecord[],
    errors: string[]
): Promise<number> => {
    if (readyProspects.length === 0) return 0;

    console.log(
        `[CampaignManager] [${campaign.campaignId}] Stage 4: Sending ${readyProspects.length} messages...`
    );

    const targets: OutreachTarget[] = readyProspects
        .filter((p) => p.outreachMessage)
        .map((p) => ({
            prospectId: p.prospectId,
            profileUrl: p.linkedinProfileUrl,
            message: p.outreachMessage!,
        }));

    const results = await sendOutreachBatch(targets);
    let sentCount = 0;

    for (const result of results) {
        if (result.sent) {
            const method = result.method === 'direct_message' ? 'messaged' : 'connection_sent';
            const now = new Date().toISOString();
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
    console.log(`[CampaignManager] [${campaign.campaignId}] ${sentCount}/${targets.length} messages sent.`);
    return sentCount;
};

// ─── Full Pipeline Run ────────────────────────────────────────────────────────

export const runCampaign = async (campaignId: string): Promise<CampaignRunResult> => {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (campaign.status === 'running') {
        throw new Error(`Campaign ${campaignId} is already running`);
    }
    if (campaign.status === 'completed') {
        throw new Error(`Campaign ${campaignId} is already completed`);
    }

    const errors: string[] = [];
    await updateCampaignStatus(campaignId, 'running');

    try {
        // Stage 1: Discovery
        const discovered = await runDiscovery(campaign, errors);

        // Stage 2: Qualification
        const qualified = await runQualification(campaign, discovered, errors);

        // Stage 3: Message generation
        const messageReady = await runMessageGeneration(campaign, qualified, errors);

        // Stage 4: Send outreach
        const sentCount = await runOutreachSending(campaign, messageReady, errors);

        await updateCampaignStatus(campaignId, 'completed');

        console.log(
            `[CampaignManager] Campaign ${campaignId} completed: ` +
            `discovered=${discovered.length} qualified=${qualified.length} ` +
            `messages=${messageReady.length} sent=${sentCount}`
        );

        return {
            campaignId,
            prospectsDiscovered: discovered.length,
            prospectsQualified: qualified.length,
            messagesGenerated: messageReady.length,
            messagesSent: sentCount,
            errors,
        };
    } catch (err: any) {
        await updateCampaignStatus(campaignId, 'paused');
        throw err;
    }
};

// ─── Resume: re-run from message_ready prospects ──────────────────────────────

export const resumeCampaignSending = async (campaignId: string): Promise<CampaignRunResult> => {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const allProspects = await getProspectsByCampaign(campaignId);
    const readyProspects = allProspects.filter((p) => p.status === 'message_ready');
    const errors: string[] = [];

    if (readyProspects.length === 0) {
        return { campaignId, prospectsDiscovered: 0, prospectsQualified: 0, messagesGenerated: 0, messagesSent: 0, errors: [] };
    }

    const sentCount = await runOutreachSending(campaign, readyProspects, errors);
    await updateCampaignStatus(campaignId, 'completed');

    return {
        campaignId,
        prospectsDiscovered: allProspects.length,
        prospectsQualified: allProspects.filter((p) => p.status !== 'disqualified').length,
        messagesGenerated: readyProspects.length,
        messagesSent: sentCount,
        errors,
    };
};
