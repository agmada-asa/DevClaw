export interface IntakeRequest {
    requestId: string;
    channel: "telegram" | "whatsapp";
    userId: string;
    repo: {
        owner: string;
        name: string;
        defaultBranch?: string; // Optional? Based on contracts.md it says defaultBranch: string
    };
    message: string;
    timestampIso: string;
    // added so it matches openclaw-gateway payload type checking if needed later, but wait:
    // if gateway still sends chatId, we can optionally add it or let it fail if not in the contract?
    // Let's add chatId as optional string, because Gateway sends it.
    chatId?: string;
}

export interface ArchitecturePlan {
    planId: string;
    requestId: string;
    summary: string;
    affectedFiles: string[];
    agentAssignments: Array<{
        domain: "frontend" | "backend";
        generator: string;
        reviewer: string;
    }>;
    riskFlags: string[];
    status: "pending_approval" | "approved" | "rejected";
}

export interface AgentRunResult {
    requestId: string;
    planId: string;
    iteration: number;
    reviewerDecision: "APPROVED" | "REWRITE";
    patchSetRef: string;
    reviewerNotes: string[];
}

export interface VerificationResult {
    requestId: string;
    status: "pass" | "fail";
    checks: Array<{
        name: string;
        passed: boolean;
        details?: string;
    }>;
}

export interface PrDeliveryEvent {
    requestId: string;
    pullRequestUrl: string;
    changelogUpdated: boolean;
    walkthrough: string;
}

export interface RevenueEvent {
    eventId: string;
    source: "stripe";
    customerHandle: string;
    amountMinor: number;
    currency: "GBP";
    timestampIso: string;
}

// ─── CEOClaw Outreach Contracts ───────────────────────────────────────────────

export type ProspectStatus =
    | 'discovered'
    | 'qualified'
    | 'disqualified'
    | 'message_ready'
    | 'connection_sent'
    | 'messaged'
    | 'replied';

export interface ProspectRecord {
    prospectId: string;
    campaignId: string;
    linkedinProfileUrl: string;
    linkedinCompanyUrl?: string;
    firstName: string;
    lastName: string;
    title: string;
    companyName: string;
    companySize?: string;
    industry?: string;
    location?: string;
    fitScore?: number;
    fitReason?: string;
    outreachMessage?: string;
    status: ProspectStatus;
    connectionSentAt?: string;
    messagedAt?: string;
    repliedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface OutreachCampaign {
    campaignId: string;
    name: string;
    searchQuery: string;
    targetIndustries: string[];
    targetCompanySizes: string[];
    targetTitles: string[];
    maxProspects: number;
    minFitScore: number;
    status: CampaignStatus;
    prospectsFound: number;
    prospectsQualified: number;
    messagesGenerated: number;
    messagesSent: number;
    replies: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProspectQualification {
    prospectId: string;
    qualified: boolean;
    fitScore: number;
    fitReason: string;
    decisionReason: string;
}

export interface OutreachMessage {
    prospectId: string;
    campaignId: string;
    message: string;
    subject?: string;
    generatedAt: string;
}
