/**
 * operationsDomain.ts
 *
 * CEOClaw operations domain — three tasks via OpenClaw CLI:
 *
 *   1. analyze_metrics    — read current business metrics, identify bottlenecks,
 *                           forecast MRR trajectory, recommend next actions
 *   2. process_feedback   — synthesize user feedback into product insights
 *                           and draft responses
 *   3. plan_iteration     — decide the single most impactful product change
 *                           based on current state and feedback
 */

import { chat } from '@devclaw/llm-router';
import { extractJsonObject } from './openclawRunner';
import {
    BusinessState,
    MetricsAnalysisOutput,
    FeedbackResponseOutput,
    IterationPlanOutput,
    MRR_GOAL,
} from './founderTypes';

// ─── Task 1: Metrics Analysis ─────────────────────────────────────────────────

const buildMetricsPrompt = (state: BusinessState): string => {
    const mrrGap = MRR_GOAL - state.mrr;
    const conversionRate = state.trafficLast30d > 0
        ? ((state.totalSignups / state.trafficLast30d) * 100).toFixed(2)
        : '0';

    return [
        'You are CEOClaw analyzing DevClaw business metrics.',
        '',
        'DevClaw target: $100 MRR. Analyze the current state and identify what to fix.',
        '',
        '── Metrics ──────────────────────────────────────────────────',
        `MRR: $${state.mrr} (goal: $${MRR_GOAL}, gap: $${mrrGap})`,
        `Phase: ${state.phase}`,
        `Signups: ${state.totalSignups} total, ${state.activeUsers} active (${state.totalSignups > 0 ? Math.round((state.activeUsers / state.totalSignups) * 100) : 0}% activation)`,
        `Traffic: ${state.trafficLast30d} page views/month`,
        `Landing page: ${state.landingPageUrl ? 'deployed' : 'NOT deployed'}`,
        `Visitor-to-signup conversion: ${conversionRate}%`,
        `Tasks run today: ${state.tasksCompletedToday}`,
        '',
        '── Your job ──────────────────────────────────────────────────',
        'Identify the biggest bottleneck in the funnel: traffic → signups → activation → revenue.',
        'Provide specific, actionable recommendations.',
        'Forecast MRR in 30 days if current trends continue.',
        '',
        'Return ONLY valid JSON:',
        '{"summary":"string","keyInsights":["string"],"bottleneck":"string","recommendedActions":["string"],"mrrForecast":"string"}',
    ].join('\n');
};

const parseMetricsAnalysis = (raw: string): MetricsAnalysisOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Metrics analysis response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        summary: String(parsed.summary || '').trim(),
        keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights.map(String) : [],
        bottleneck: String(parsed.bottleneck || '').trim(),
        recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.map(String) : [],
        mrrForecast: String(parsed.mrrForecast || '').trim(),
    };
};

export const analyzeMetrics = async (state: BusinessState): Promise<MetricsAnalysisOutput> => {
    console.log('[OperationsDomain] Analyzing metrics via GLM...');
    const prompt = buildMetricsPrompt(state);
    const response = await chat({
        role: 'orchestrator',
        messages: [{ role: 'user', content: prompt }],
        requestId: `ceoclaw-metrics-${Date.now()}`,
    });
    const raw = response.content;
    const output = parseMetricsAnalysis(raw);
    console.log(`[OperationsDomain] Bottleneck: ${output.bottleneck}`);
    console.log(`[OperationsDomain] MRR forecast: ${output.mrrForecast}`);
    return output;
};

// ─── Task 2: Feedback Processing ─────────────────────────────────────────────

// In production this would pull from a feedback table in Supabase.
// For now we pass the current state and ask OpenClaw to synthesize
// hypothetical feedback patterns based on the business phase.
const buildFeedbackPrompt = (state: BusinessState, feedback?: string): string => [
    'You are CEOClaw processing user feedback for DevClaw.',
    '',
    `Current phase: ${state.phase}, MRR: $${state.mrr}, signups: ${state.totalSignups}`,
    '',
    feedback
        ? `User feedback received:\n"${feedback}"`
        : `No specific feedback provided. Based on phase=${state.phase} and MRR=$${state.mrr},` +
          ' synthesize the most likely user concerns and pain points.',
    '',
    'Provide:',
    '  - A brief summary of the feedback theme',
    '  - A draft response to the user (if specific feedback given) or a proactive outreach message',
    '  - What this implies about the product (feature gap, UX issue, messaging problem, etc.)',
    '',
    'Return ONLY valid JSON:',
    '{"feedbackSummary":"string","responseMessage":"string","productImplication":"string"}',
].join('\n');

const parseFeedbackResponse = (raw: string): FeedbackResponseOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Feedback response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        feedbackSummary: String(parsed.feedbackSummary || '').trim(),
        responseMessage: String(parsed.responseMessage || '').trim(),
        productImplication: String(parsed.productImplication || '').trim(),
    };
};

export const processFeedback = async (
    state: BusinessState,
    feedback?: string
): Promise<FeedbackResponseOutput> => {
    console.log('[OperationsDomain] Processing feedback via GLM...');
    const prompt = buildFeedbackPrompt(state, feedback);
    const response = await chat({
        role: 'orchestrator',
        messages: [{ role: 'user', content: prompt }],
        requestId: `ceoclaw-feedback-${Date.now()}`,
    });
    const raw = response.content;
    const output = parseFeedbackResponse(raw);
    console.log(`[OperationsDomain] Feedback implication: ${output.productImplication}`);
    return output;
};

// ─── Task 3: Iteration Planning ───────────────────────────────────────────────

const buildIterationPrompt = (state: BusinessState): string => [
    'You are CEOClaw deciding the next product iteration for DevClaw.',
    '',
    'DevClaw automates GitHub PRs via Telegram + AI agents.',
    '',
    `MRR: $${state.mrr} / $${MRR_GOAL}, phase: ${state.phase}`,
    `Signups: ${state.totalSignups}, active: ${state.activeUsers}`,
    `Traffic: ${state.trafficLast30d}/month`,
    state.latestIdea ? `Previous idea: ${state.latestIdea}` : '',
    '',
    'Decide the SINGLE most important product improvement to make right now.',
    'Think in terms of: onboarding friction, missing features, performance, reliability, UX.',
    'The change should be completable in 1-3 days by a small team.',
    '',
    'Return ONLY valid JSON:',
    '{"currentProblem":"string","proposedFix":"string","estimatedEffort":"small|medium|large","expectedOutcome":"string","priority":"high|medium|low"}',
].join('\n');

const parseIterationPlan = (raw: string): IterationPlanOutput => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Iteration plan response missing JSON');
    const parsed = JSON.parse(jsonText);
    return {
        currentProblem: String(parsed.currentProblem || '').trim(),
        proposedFix: String(parsed.proposedFix || '').trim(),
        estimatedEffort: (['small', 'medium', 'large'].includes(parsed.estimatedEffort)
            ? parsed.estimatedEffort : 'medium') as 'small' | 'medium' | 'large',
        expectedOutcome: String(parsed.expectedOutcome || '').trim(),
        priority: (['high', 'medium', 'low'].includes(parsed.priority)
            ? parsed.priority : 'medium') as 'high' | 'medium' | 'low',
    };
};

export const planIteration = async (state: BusinessState): Promise<IterationPlanOutput> => {
    console.log('[OperationsDomain] Planning next iteration via GLM...');
    const prompt = buildIterationPrompt(state);
    const response = await chat({
        role: 'orchestrator',
        messages: [{ role: 'user', content: prompt }],
        requestId: `ceoclaw-iteration-${Date.now()}`,
    });
    const raw = response.content;
    const output = parseIterationPlan(raw);
    console.log(`[OperationsDomain] Iteration: "${output.proposedFix}" (${output.estimatedEffort})`);
    return output;
};
