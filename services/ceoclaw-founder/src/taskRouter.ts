/**
 * taskRouter.ts
 *
 * The brain of CEOClaw's agent loop.
 *
 * Given the current business state and recent task history, asks OpenClaw
 * to decide which task will have the highest leverage toward $100 MRR.
 *
 * OpenClaw acts as a strategic advisor — it reads state, weighs priorities,
 * and returns the next concrete action to execute.
 */

import { runOpenClawPrompt, extractJsonObject } from './openclawRunner';
import { BusinessState, RoutedTask, TaskType, TaskDomain, TaskPriority, MRR_GOAL } from './founderTypes';

// ─── Prompt ───────────────────────────────────────────────────────────────────

const buildRoutingPrompt = (
    state: BusinessState,
    recentTaskTypes: string[]
): string => {
    const mrrGap = Math.max(0, MRR_GOAL - state.mrr);
    const mrrPct = Math.round((state.mrr / MRR_GOAL) * 100);

    return [
        'You are CEOClaw — an autonomous AI founder running DevClaw, a B2B SaaS.',
        '',
        'DevClaw is an AI coding assistant: developers describe bugs/features in Telegram,',
        'DevClaw creates a GitHub issue, generates an architecture plan, runs AI agents to',
        'write the code, and opens a PR — all with a human approval gate.',
        '',
        `GOAL: Reach $${MRR_GOAL} Monthly Recurring Revenue (MRR).`,
        '',
        '── Current Business State ───────────────────────────────────',
        `MRR: $${state.mrr} / $${MRR_GOAL} (${mrrPct}% of goal, $${mrrGap} remaining)`,
        `Phase: ${state.phase}`,
        `Signups: ${state.totalSignups} total, ${state.activeUsers} active`,
        `Traffic: ${state.trafficLast30d} page views (last 30 days)`,
        `Landing page: ${state.landingPageUrl ? `live at ${state.landingPageUrl}` : 'NOT YET DEPLOYED'}`,
        `Latest idea: ${state.latestIdea || 'none yet'}`,
        `Latest SEO content: ${state.latestContentTitle || 'none yet'}`,
        `Tasks completed today: ${state.tasksCompletedToday}`,
        `Recent tasks: ${recentTaskTypes.length > 0 ? recentTaskTypes.join(', ') : 'none'}`,
        '',
        '── Available Tasks ──────────────────────────────────────────',
        'product.generate_idea      — Brainstorm a product feature or positioning improvement',
        'product.build_landing_page — Write and generate a landing page for DevClaw',
        'marketing.write_seo_content — Write an SEO blog post to drive organic traffic',
        'marketing.plan_campaign    — Plan a targeted outreach email/LinkedIn campaign',
        'sales.find_prospects       — Search LinkedIn for qualified startup/dev shop leads',
        'sales.send_outreach        — Send pending connection requests to qualified prospects',
        'operations.analyze_metrics — Analyze current traffic/signup/MRR metrics for bottlenecks',
        'operations.process_feedback — Review user feedback and draft product responses',
        'operations.plan_iteration  — Decide the next product iteration based on current data',
        '',
        '── Instructions ─────────────────────────────────────────────',
        'Pick the single task that will have the HIGHEST LEVERAGE toward $100 MRR right now.',
        'Avoid repeating the same task as the most recent one unless it is urgent.',
        'If landing page is not deployed, prioritize product.build_landing_page.',
        'If MRR is 0 and signups exist, prioritize sales tasks.',
        'If traffic is 0, prioritize marketing tasks.',
        '',
        'Return ONLY valid JSON — no markdown, no commentary:',
        '{"task":"<task.type>","domain":"<domain>","reason":"<one sentence why this is highest leverage now>","priority":"high|medium|low"}',
    ].join('\n');
};

// ─── Response parsing ─────────────────────────────────────────────────────────

const VALID_TASK_TYPES = new Set<string>([
    'product.generate_idea',
    'product.build_landing_page',
    'marketing.write_seo_content',
    'marketing.plan_campaign',
    'sales.find_prospects',
    'sales.send_outreach',
    'operations.analyze_metrics',
    'operations.process_feedback',
    'operations.plan_iteration',
]);

const DOMAIN_MAP: Record<string, TaskDomain> = {
    'product.generate_idea': 'product',
    'product.build_landing_page': 'product',
    'marketing.write_seo_content': 'marketing',
    'marketing.plan_campaign': 'marketing',
    'sales.find_prospects': 'sales',
    'sales.send_outreach': 'sales',
    'operations.analyze_metrics': 'operations',
    'operations.process_feedback': 'operations',
    'operations.plan_iteration': 'operations',
};

const parseRoutedTask = (raw: string): RoutedTask => {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) throw new Error('Task router response did not contain JSON');

    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch {
        throw new Error('Task router JSON could not be parsed');
    }

    const task = typeof parsed.task === 'string' ? parsed.task.trim() : '';
    if (!VALID_TASK_TYPES.has(task)) {
        console.warn(`[TaskRouter] Unknown task type "${task}" — defaulting to operations.analyze_metrics`);
        return {
            taskType: 'operations.analyze_metrics',
            domain: 'operations',
            reason: 'Fallback: task type was not recognized',
            priority: 'low',
        };
    }

    return {
        taskType: task as TaskType,
        domain: DOMAIN_MAP[task],
        reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
        priority: (['high', 'medium', 'low'].includes(parsed.priority) ? parsed.priority : 'medium') as TaskPriority,
    };
};

// ─── Fallback heuristic (when OpenClaw CLI is unavailable) ────────────────────

const heuristicRoute = (state: BusinessState, recentTasks: string[]): RoutedTask => {
    // If no landing page → build one first
    if (!state.landingPageUrl) {
        return { taskType: 'product.build_landing_page', domain: 'product', reason: 'Landing page not yet deployed', priority: 'high' };
    }
    // No traffic → write SEO content
    if (state.trafficLast30d < 100) {
        const last = recentTasks[0];
        if (last !== 'marketing.write_seo_content') {
            return { taskType: 'marketing.write_seo_content', domain: 'marketing', reason: 'Traffic is low — SEO content will drive organic visitors', priority: 'high' };
        }
    }
    // MRR is 0 → push sales
    if (state.mrr === 0 && state.totalSignups > 0) {
        return { taskType: 'sales.find_prospects', domain: 'sales', reason: 'No MRR yet — find prospects to convert', priority: 'high' };
    }
    // Default rotation
    const rotation: TaskType[] = [
        'sales.find_prospects',
        'marketing.write_seo_content',
        'sales.send_outreach',
        'operations.analyze_metrics',
        'product.generate_idea',
    ];
    const next = rotation.find((t) => !recentTasks.includes(t)) || rotation[0];
    return { taskType: next, domain: DOMAIN_MAP[next], reason: 'Heuristic rotation', priority: 'medium' };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const routeNextTask = async (
    state: BusinessState,
    recentTaskTypes: string[]
): Promise<RoutedTask> => {
    const engine = (process.env.CEOCLAW_AGENT_ENGINE || 'openclaw').toLowerCase();

    if (engine !== 'openclaw') {
        console.log('[TaskRouter] Using heuristic routing (CEOCLAW_AGENT_ENGINE != openclaw)');
        return heuristicRoute(state, recentTaskTypes);
    }

    console.log('[TaskRouter] Asking OpenClaw to route next task...');
    try {
        const prompt = buildRoutingPrompt(state, recentTaskTypes);
        const raw = await runOpenClawPrompt(prompt, { timeoutMs: 60_000 });
        const task = parseRoutedTask(raw);
        console.log(`[TaskRouter] Routed to: ${task.taskType} (${task.priority}) — ${task.reason}`);
        return task;
    } catch (err: any) {
        console.warn(`[TaskRouter] OpenClaw routing failed, using heuristic: ${err.message}`);
        return heuristicRoute(state, recentTaskTypes);
    }
};
