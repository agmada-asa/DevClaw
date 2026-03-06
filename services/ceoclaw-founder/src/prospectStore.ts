import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProspectRecord, OutreachCampaign, ProspectStatus, CampaignStatus } from '@devclaw/contracts';

// ─── Supabase Setup ───────────────────────────────────────────────────────────
// Required tables (run once in Supabase SQL editor):
//
//   create table ceoclaw_campaigns (
//     campaign_id text primary key,
//     name text not null,
//     search_query text not null,
//     target_industries jsonb default '[]',
//     target_company_sizes jsonb default '[]',
//     target_titles jsonb default '[]',
//     max_prospects int default 50,
//     min_fit_score int default 60,
//     status text default 'draft',
//     prospects_found int default 0,
//     prospects_qualified int default 0,
//     messages_generated int default 0,
//     messages_sent int default 0,
//     replies int default 0,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );
//
//   create table ceoclaw_prospects (
//     prospect_id text primary key,
//     campaign_id text references ceoclaw_campaigns(campaign_id),
//     linkedin_profile_url text not null,
//     linkedin_company_url text,
//     first_name text not null,
//     last_name text not null,
//     title text not null,
//     company_name text not null,
//     company_size text,
//     industry text,
//     location text,
//     fit_score int,
//     fit_reason text,
//     outreach_message text,
//     status text default 'discovered',
//     connection_sent_at timestamptz,
//     messaged_at timestamptz,
//     replied_at timestamptz,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );

let supabaseInstance: SupabaseClient | null = null;

const getSupabase = (): SupabaseClient | null => {
    if (supabaseInstance) return supabaseInstance;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    supabaseInstance = createClient(url, key);
    return supabaseInstance;
};

// ─── Campaign CRUD ────────────────────────────────────────────────────────────

export const saveCampaign = async (campaign: OutreachCampaign): Promise<void> => {
    const db = getSupabase();
    if (!db) {
        console.warn('[ProspectStore] Supabase not configured — campaign not persisted.');
        return;
    }
    const { error } = await db.from('ceoclaw_campaigns').upsert({
        campaign_id: campaign.campaignId,
        name: campaign.name,
        search_query: campaign.searchQuery,
        target_industries: campaign.targetIndustries,
        target_company_sizes: campaign.targetCompanySizes,
        target_titles: campaign.targetTitles,
        max_prospects: campaign.maxProspects,
        min_fit_score: campaign.minFitScore,
        status: campaign.status,
        prospects_found: campaign.prospectsFound,
        prospects_qualified: campaign.prospectsQualified,
        messages_generated: campaign.messagesGenerated,
        messages_sent: campaign.messagesSent,
        replies: campaign.replies,
        created_at: campaign.createdAt,
        updated_at: campaign.updatedAt,
    }, { onConflict: 'campaign_id' });

    if (error) {
        console.error('[ProspectStore] Failed to save campaign:', error.message);
    }
};

export const getCampaign = async (campaignId: string): Promise<OutreachCampaign | null> => {
    const db = getSupabase();
    if (!db) return null;
    const { data, error } = await db
        .from('ceoclaw_campaigns')
        .select('*')
        .eq('campaign_id', campaignId)
        .single();

    if (error || !data) return null;
    return mapCampaignRow(data);
};

export const updateCampaignStatus = async (
    campaignId: string,
    status: CampaignStatus,
    counters?: Partial<Pick<OutreachCampaign,
        'prospectsFound' | 'prospectsQualified' | 'messagesGenerated' | 'messagesSent' | 'replies'>>
): Promise<void> => {
    const db = getSupabase();
    if (!db) return;
    const patch: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
    };
    if (counters?.prospectsFound !== undefined) patch.prospects_found = counters.prospectsFound;
    if (counters?.prospectsQualified !== undefined) patch.prospects_qualified = counters.prospectsQualified;
    if (counters?.messagesGenerated !== undefined) patch.messages_generated = counters.messagesGenerated;
    if (counters?.messagesSent !== undefined) patch.messages_sent = counters.messagesSent;
    if (counters?.replies !== undefined) patch.replies = counters.replies;

    const { error } = await db.from('ceoclaw_campaigns').update(patch).eq('campaign_id', campaignId);
    if (error) {
        console.error('[ProspectStore] Failed to update campaign status:', error.message);
    }
};

export const listCampaigns = async (): Promise<OutreachCampaign[]> => {
    const db = getSupabase();
    if (!db) return [];
    const { data, error } = await db
        .from('ceoclaw_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map(mapCampaignRow);
};

// ─── Prospect CRUD ────────────────────────────────────────────────────────────

export const saveProspect = async (prospect: ProspectRecord): Promise<void> => {
    const db = getSupabase();
    if (!db) {
        console.warn('[ProspectStore] Supabase not configured — prospect not persisted.');
        return;
    }
    const { error } = await db.from('ceoclaw_prospects').upsert({
        prospect_id: prospect.prospectId,
        campaign_id: prospect.campaignId,
        linkedin_profile_url: prospect.linkedinProfileUrl,
        linkedin_company_url: prospect.linkedinCompanyUrl,
        first_name: prospect.firstName,
        last_name: prospect.lastName,
        title: prospect.title,
        company_name: prospect.companyName,
        company_size: prospect.companySize,
        industry: prospect.industry,
        location: prospect.location,
        fit_score: prospect.fitScore,
        fit_reason: prospect.fitReason,
        outreach_message: prospect.outreachMessage,
        status: prospect.status,
        connection_sent_at: prospect.connectionSentAt,
        messaged_at: prospect.messagedAt,
        replied_at: prospect.repliedAt,
        created_at: prospect.createdAt,
        updated_at: prospect.updatedAt,
    }, { onConflict: 'prospect_id' });

    if (error) {
        console.error('[ProspectStore] Failed to save prospect:', error.message);
    }
};

export const updateProspectStatus = async (
    prospectId: string,
    status: ProspectStatus,
    patch?: Partial<Pick<ProspectRecord, 'fitScore' | 'fitReason' | 'outreachMessage' | 'connectionSentAt' | 'messagedAt'>>
): Promise<void> => {
    const db = getSupabase();
    if (!db) return;
    const update: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
    };
    if (patch?.fitScore !== undefined) update.fit_score = patch.fitScore;
    if (patch?.fitReason !== undefined) update.fit_reason = patch.fitReason;
    if (patch?.outreachMessage !== undefined) update.outreach_message = patch.outreachMessage;
    if (patch?.connectionSentAt !== undefined) update.connection_sent_at = patch.connectionSentAt;
    if (patch?.messagedAt !== undefined) update.messaged_at = patch.messagedAt;

    const { error } = await db.from('ceoclaw_prospects').update(update).eq('prospect_id', prospectId);
    if (error) {
        console.error('[ProspectStore] Failed to update prospect status:', error.message);
    }
};

export const getProspectsByCampaign = async (campaignId: string): Promise<ProspectRecord[]> => {
    const db = getSupabase();
    if (!db) return [];
    const { data, error } = await db
        .from('ceoclaw_prospects')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(mapProspectRow);
};

export const getProspectsByStatus = async (status: ProspectStatus): Promise<ProspectRecord[]> => {
    const db = getSupabase();
    if (!db) return [];
    const { data, error } = await db
        .from('ceoclaw_prospects')
        .select('*')
        .eq('status', status)
        .order('connection_sent_at', { ascending: true });

    if (error || !data) return [];
    return data.map(mapProspectRow);
};

export const isAlreadyProspected = async (
    campaignId: string,
    linkedinProfileUrl: string
): Promise<boolean> => {
    const db = getSupabase();
    if (!db) return false;
    const { data } = await db
        .from('ceoclaw_prospects')
        .select('prospect_id')
        .eq('campaign_id', campaignId)
        .eq('linkedin_profile_url', linkedinProfileUrl)
        .limit(1);

    return !!(data && data.length > 0);
};

// ─── Row Mappers ──────────────────────────────────────────────────────────────

const mapCampaignRow = (row: Record<string, any>): OutreachCampaign => ({
    campaignId: row.campaign_id,
    name: row.name,
    searchQuery: row.search_query,
    targetIndustries: row.target_industries || [],
    targetCompanySizes: row.target_company_sizes || [],
    targetTitles: row.target_titles || [],
    maxProspects: row.max_prospects,
    minFitScore: row.min_fit_score,
    status: row.status,
    prospectsFound: row.prospects_found || 0,
    prospectsQualified: row.prospects_qualified || 0,
    messagesGenerated: row.messages_generated || 0,
    messagesSent: row.messages_sent || 0,
    replies: row.replies || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const mapProspectRow = (row: Record<string, any>): ProspectRecord => ({
    prospectId: row.prospect_id,
    campaignId: row.campaign_id,
    linkedinProfileUrl: row.linkedin_profile_url,
    linkedinCompanyUrl: row.linkedin_company_url,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title,
    companyName: row.company_name,
    companySize: row.company_size,
    industry: row.industry,
    location: row.location,
    fitScore: row.fit_score,
    fitReason: row.fit_reason,
    outreachMessage: row.outreach_message,
    status: row.status,
    connectionSentAt: row.connection_sent_at,
    messagedAt: row.messaged_at,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});
