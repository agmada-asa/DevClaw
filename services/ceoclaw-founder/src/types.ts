// Raw prospect data extracted from a LinkedIn search result card.
// This is pre-qualification state before the LLM scores the prospect.
export interface RawProspect {
    firstName: string;
    lastName: string;
    title: string;
    companyName: string;
    linkedinProfileUrl: string;
    linkedinCompanyUrl?: string;
    location?: string;
    industry?: string;
    companySize?: string;
    connectionDegree?: '1st' | '2nd' | '3rd+';
}

// Input to the qualification agent
export interface QualifyInput {
    prospectId: string;
    firstName: string;
    lastName: string;
    title: string;
    companyName: string;
    industry?: string;
    companySize?: string;
    location?: string;
}

// Output from the qualification agent
export interface QualificationResult {
    qualified: boolean;
    fitScore: number;       // 0-100
    fitReason: string;      // Short explanation of why they're a fit
    decisionReason: string; // Full reasoning
}

// Input to the message generation agent
export interface MessageInput {
    prospectId: string;
    firstName: string;
    lastName: string;
    title: string;
    companyName: string;
    industry?: string;
    companySize?: string;
    fitReason?: string;
}

// Output from the message generation agent
export interface MessageResult {
    message: string;   // LinkedIn connection note (≤300 chars)
    subject?: string;  // Optional longer follow-up subject
}

// Config for a LinkedIn search run
export interface LinkedInSearchConfig {
    query: string;
    maxResults: number;
    delayBetweenActionsMs: number;
    maxDurationMs?: number;
    onProgress?: (progress: LinkedInSearchProgress) => Promise<void> | void;
}

export interface LinkedInSearchProgress {
    page: number;
    maxPages: number;
    found: number;
    maxResults: number;
    query: string;
    timeboxReached?: boolean;
}

// Agent engine selection — mirrors RUNNER_ENGINE pattern in agent-runner
export type CeoClawAgentEngine = 'openclaw' | 'direct';
