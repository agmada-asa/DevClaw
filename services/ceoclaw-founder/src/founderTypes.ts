/**
 * founderTypes.ts
 *
 * TypeScript interfaces for the CEOClaw autonomous founder loop.
 * Covers business state, task routing, and per-domain task I/O.
 */

// ─── Business State ───────────────────────────────────────────────────────────

export type BusinessPhase = 'pre-launch' | 'launched' | 'growth' | 'scaling';

export interface BusinessState {
    mrr: number;                // Monthly Recurring Revenue (USD)
    totalSignups: number;       // Cumulative user signups
    activeUsers: number;        // Active in last 30 days
    trafficLast30d: number;     // Page views last 30 days
    landingPageUrl?: string;    // Live landing page URL (once deployed)
    latestIdea?: string;        // Most recent product idea generated
    latestContentTitle?: string; // Most recent SEO content title published
    tasksCompletedToday: number;
    tasksCompletedTotal: number;
    loopEnabled: boolean;
    phase: BusinessPhase;
    updatedAt: string;
}

export const MRR_GOAL = 100; // USD — $100 MRR milestone

// ─── Task System ──────────────────────────────────────────────────────────────

export type TaskDomain = 'product' | 'marketing' | 'sales' | 'operations';

export type TaskType =
    | 'product.generate_idea'
    | 'product.build_landing_page'
    | 'marketing.write_seo_content'
    | 'marketing.plan_campaign'
    | 'sales.find_prospects'
    | 'sales.send_outreach'
    | 'operations.analyze_metrics'
    | 'operations.process_feedback'
    | 'operations.plan_iteration';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface RoutedTask {
    taskType: TaskType;
    domain: TaskDomain;
    reason: string;
    priority: TaskPriority;
}

export interface TaskRecord {
    taskId: string;
    taskType: TaskType;
    domain: TaskDomain;
    status: TaskStatus;
    reason: string;
    priority: TaskPriority;
    input?: Record<string, unknown>;
    output?: TaskOutput;
    error?: string;
    mrrAtTime: number;
    startedAt: string;
    completedAt?: string;
}

// ─── Domain Task Outputs ──────────────────────────────────────────────────────

export interface ProductIdeaOutput {
    idea: string;
    rationale: string;
    nextSteps: string[];
    estimatedImpact: string;
}

export interface LandingPageOutput {
    html: string;
    headline: string;
    subheadline: string;
    ctaText: string;
    deployCommand?: string;
}

export interface SeoContentOutput {
    title: string;
    slug: string;
    metaDescription: string;
    markdown: string;
    targetKeywords: string[];
}

export interface CampaignPlanOutput {
    campaignName: string;
    targetAudience: string;
    channels: string[];
    messageAngle: string;
    emailSubject: string;
    emailBody: string;
    followUpSequence: string[];
}

export interface MetricsAnalysisOutput {
    summary: string;
    keyInsights: string[];
    bottleneck: string;
    recommendedActions: string[];
    mrrForecast: string;
}

export interface FeedbackResponseOutput {
    feedbackSummary: string;
    responseMessage: string;
    productImplication: string;
}

export interface IterationPlanOutput {
    currentProblem: string;
    proposedFix: string;
    estimatedEffort: 'small' | 'medium' | 'large';
    expectedOutcome: string;
    priority: TaskPriority;
}

export interface SalesProspectOutput {
    prospectsFound: number;
    campaignId: string;
}

export interface SalesOutreachOutput {
    messagesSent: number;
    campaignId: string;
}

export type TaskOutput =
    | ProductIdeaOutput
    | LandingPageOutput
    | SeoContentOutput
    | CampaignPlanOutput
    | MetricsAnalysisOutput
    | FeedbackResponseOutput
    | IterationPlanOutput
    | SalesProspectOutput
    | SalesOutreachOutput;

// ─── Loop Status ──────────────────────────────────────────────────────────────

export interface LoopStatus {
    running: boolean;
    intervalMs: number;
    iterationsRun: number;
    lastIterationAt?: string;
    lastTaskType?: TaskType;
    lastTaskStatus?: TaskStatus;
    currentMrr: number;
    mrrGoal: number;
    mrrProgress: string; // e.g. "42%"
    phase: BusinessPhase;
}
