import axios from 'axios';
import { ArchitecturePlan } from '@devclaw/contracts';

export interface PlannerPromptInput {
    requestId: string;
    userId: string;
    repo: string;
    description: string;
    issueNumber?: number;
}

export interface PlanRevisionInput {
    existingPlan: Pick<
        ArchitecturePlan,
        'planId' | 'requestId' | 'summary' | 'affectedFiles' | 'agentAssignments' | 'riskFlags'
    >;
    changeRequest: string;
    context?: string;
}

interface ProviderPlanPayload {
    summary: string;
    affectedFiles: string[];
    agentAssignments: Array<{
        domain: 'frontend' | 'backend';
        generator: string;
        reviewer: string;
    }>;
    riskFlags: string[];
}

interface ZaiMessage {
    role: 'system' | 'user';
    content: string;
}

const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12);
};

const uniqueStrings = (items: string[]): string[] =>
    Array.from(
        new Set(
            items
                .map((item) => item.trim())
                .filter(Boolean)
        )
    );

const sanitizeAssignments = (value: unknown): ProviderPlanPayload['agentAssignments'] => {
    if (!Array.isArray(value)) return [];
    const sanitized = value
        .filter((item) => typeof item === 'object' && item !== null)
        .map((item: any) => {
            const domain: 'frontend' | 'backend' = item.domain === 'frontend' ? 'frontend' : 'backend';
            return {
                domain,
                generator: typeof item.generator === 'string' && item.generator.trim()
                    ? item.generator.trim()
                    : domain === 'frontend'
                        ? 'FrontendGenerator'
                        : 'BackendGenerator',
                reviewer: typeof item.reviewer === 'string' && item.reviewer.trim()
                    ? item.reviewer.trim()
                    : domain === 'frontend'
                        ? 'FrontendReviewer'
                        : 'BackendReviewer',
            };
        });
    return sanitized.slice(0, 4);
};

const extractJsonObject = (text: string): string | null => {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
        return text.slice(start, end + 1).trim();
    }

    return null;
};

const inferAffectedFiles = (text: string): string[] => {
    const lower = text.toLowerCase();
    const files: string[] = [];

    if (/(ui|frontend|button|mobile|css|layout|react|next|page)/.test(lower)) {
        files.push('apps/dashboard/src/components/*', 'apps/dashboard/src/pages/*');
    }
    if (/(api|backend|server|endpoint|db|database|auth|token)/.test(lower)) {
        files.push('services/orchestrator/src/*', 'packages/contracts/src/*');
    }
    if (/(gateway|ingress|webhook|callback)/.test(lower)) {
        files.push('services/openclaw-gateway/src/*');
    }
    if (files.length === 0) {
        files.push('services/orchestrator/src/*');
    }

    return uniqueStrings(files).slice(0, 12);
};

const inferRiskFlags = (text: string): string[] => {
    const lower = text.toLowerCase();
    const risks: string[] = [];

    if (/(auth|token|oauth|permission|security)/.test(lower)) {
        risks.push('Touches authentication/security paths');
    }
    if (/(db|migration|schema|sql)/.test(lower)) {
        risks.push('Potential data model impact');
    }
    if (/(mobile|safari|ios|android)/.test(lower)) {
        risks.push('Cross-browser and mobile compatibility risk');
    }
    if (/(queue|retry|job|worker|async)/.test(lower)) {
        risks.push('Asynchronous processing and retry behavior may change');
    }

    return uniqueStrings(risks).slice(0, 12);
};

const buildDeterministicFallback = (input: PlannerPromptInput): ProviderPlanPayload => {
    const lower = input.description.toLowerCase();
    const mentionsUi = /(ui|frontend|button|mobile|css|layout|react|next|page)/.test(lower);
    const mentionsBackend = /(api|backend|server|endpoint|db|database|auth|token)/.test(lower);

    const affectedFiles = inferAffectedFiles(input.description);

    const assignments: ProviderPlanPayload['agentAssignments'] = [];
    if (mentionsUi) {
        assignments.push({
            domain: 'frontend',
            generator: 'FrontendGenerator',
            reviewer: 'FrontendReviewer',
        });
    }
    if (mentionsBackend || assignments.length === 0) {
        assignments.push({
            domain: 'backend',
            generator: 'BackendGenerator',
            reviewer: 'BackendReviewer',
        });
    }

    const riskFlags = inferRiskFlags(input.description);

    return {
        summary: `Plan generated for request "${input.description.slice(0, 140)}" in ${input.repo}.`,
        affectedFiles,
        agentAssignments: assignments,
        riskFlags,
    };
};

const buildDeterministicRevisionFallback = (input: PlanRevisionInput): ProviderPlanPayload => {
    const baseAssignments = input.existingPlan.agentAssignments.length
        ? input.existingPlan.agentAssignments
        : [
            {
                domain: 'backend' as const,
                generator: 'BackendGenerator',
                reviewer: 'BackendReviewer',
            },
        ];

    const inferredFiles = inferAffectedFiles(
        `${input.changeRequest}\n${input.context || ''}`
    );
    const inferredRisks = inferRiskFlags(
        `${input.changeRequest}\n${input.context || ''}`
    );

    const affectedFiles = uniqueStrings([
        ...input.existingPlan.affectedFiles,
        ...inferredFiles,
    ]).slice(0, 12);

    const riskFlags = uniqueStrings([
        ...input.existingPlan.riskFlags,
        ...inferredRisks,
    ]).slice(0, 12);

    return {
        summary: [
            `Plan updated: ${input.changeRequest.slice(0, 120)}.`,
            input.existingPlan.summary,
        ].join(' '),
        affectedFiles,
        agentAssignments: baseAssignments,
        riskFlags,
    };
};

const parseProviderPayload = (rawContent: string): ProviderPlanPayload | null => {
    const jsonText = extractJsonObject(rawContent);
    if (!jsonText) return null;

    try {
        const parsed = JSON.parse(jsonText);
        const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : '';
        const affectedFiles = normalizeStringArray(parsed.affectedFiles);
        const riskFlags = normalizeStringArray(parsed.riskFlags);
        const agentAssignments = sanitizeAssignments(parsed.agentAssignments);

        if (!summary) return null;
        if (affectedFiles.length === 0) return null;
        if (agentAssignments.length === 0) return null;

        return {
            summary,
            affectedFiles,
            riskFlags,
            agentAssignments,
        };
    } catch {
        return null;
    }
};

const callZaiForPlan = async (
    messages: ZaiMessage[],
    fallbackPlan: ProviderPlanPayload,
    failureContext: string
): Promise<ProviderPlanPayload> => {
    const apiKey = process.env.ZAI_API_KEY;
    if (!apiKey) {
        console.warn('================================================================================');
        console.warn(`⚠️  ZAI API key not found. Using DETERMINISTIC fallback for ${failureContext}.`);
        console.warn('================================================================================');
        return fallbackPlan;
    }

    const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
    const model = process.env.ZAI_GLM_MODEL || 'glm-4.7';

    try {
        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model,
                temperature: 0.2,
                messages,
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 20000,
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            console.error('================================================================================');
            console.error('❌ Invalid response from ZAI GLM:', content);
            console.error(`   Using DETERMINISTIC fallback for ${failureContext}.`);
            console.error('================================================================================');
            return fallbackPlan;
        }

        const parsed = parseProviderPayload(content);
        return parsed || fallbackPlan;
    } catch (err) {
        console.error('================================================================================');
        console.error(`❌ Failed to generate ${failureContext} with ZAI GLM. Using DETERMINISTIC fallback.`);
        console.error('================================================================================');
        console.error(err);
        return fallbackPlan;
    }
};

const planWithZaiGlm = async (input: PlannerPromptInput): Promise<ProviderPlanPayload> => {
    const systemPrompt = [
        'You are the DevClaw architecture planner.',
        'Return JSON only. No markdown.',
        'Return this exact shape:',
        '{"summary":"string","affectedFiles":["string"],"agentAssignments":[{"domain":"frontend|backend","generator":"string","reviewer":"string"}],"riskFlags":["string"]}',
        'Keep values concise and actionable.',
    ].join(' ');

    const userPrompt = [
        `requestId: ${input.requestId}`,
        `userId: ${input.userId}`,
        `repo: ${input.repo}`,
        `issueNumber: ${input.issueNumber ?? 'n/a'}`,
        `description: ${input.description}`,
    ].join('\n');

    return callZaiForPlan(
        [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        buildDeterministicFallback(input),
        'plan generation'
    );
};

const reviseWithZaiGlm = async (input: PlanRevisionInput): Promise<ProviderPlanPayload> => {
    const systemPrompt = [
        'You are the OpenClaw architecture planner.',
        'Revise existing plans based on a change request.',
        'Return JSON only. No markdown.',
        'Return this exact shape:',
        '{"summary":"string","affectedFiles":["string"],"agentAssignments":[{"domain":"frontend|backend","generator":"string","reviewer":"string"}],"riskFlags":["string"]}',
        'Preserve useful context from existing plan while applying the requested changes.',
    ].join(' ');

    const userPrompt = [
        `planId: ${input.existingPlan.planId}`,
        `requestId: ${input.existingPlan.requestId}`,
        `existingSummary: ${input.existingPlan.summary}`,
        `existingAffectedFiles: ${JSON.stringify(input.existingPlan.affectedFiles)}`,
        `existingAssignments: ${JSON.stringify(input.existingPlan.agentAssignments)}`,
        `existingRiskFlags: ${JSON.stringify(input.existingPlan.riskFlags)}`,
        `changeRequest: ${input.changeRequest}`,
        `context: ${input.context || 'n/a'}`,
    ].join('\n');

    return callZaiForPlan(
        [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        buildDeterministicRevisionFallback(input),
        'plan revision'
    );
};

const useZaiProvider = (): boolean => {
    const provider = (process.env.LLM_PROVIDER || 'zai_glm').toLowerCase();
    return provider === 'zai_glm' || provider === 'zai' || provider === 'glm';
};

export const generateArchitecturePlan = async (
    input: PlannerPromptInput
): Promise<ArchitecturePlan> => {
    let providerPlan: ProviderPlanPayload;
    if (useZaiProvider()) {
        console.log('================================================================================');
        console.log('🧠 Architecture Planner is using ZAI to handle processing');
        console.log('================================================================================');
        providerPlan = await planWithZaiGlm(input);
    } else {
        console.log('================================================================================');
        console.log('⚙️  Architecture Planner is using DETERMINISTIC methods to handle processing');
        console.log('================================================================================');
        providerPlan = buildDeterministicFallback(input);
    }

    return {
        planId: `plan-${input.requestId.slice(0, 8)}`,
        requestId: input.requestId,
        summary: providerPlan.summary,
        affectedFiles: providerPlan.affectedFiles,
        agentAssignments: providerPlan.agentAssignments,
        riskFlags: providerPlan.riskFlags,
        status: 'pending_approval',
    };
};

export const reviseArchitecturePlan = async (
    input: PlanRevisionInput
): Promise<ArchitecturePlan> => {
    let providerPlan: ProviderPlanPayload;
    if (useZaiProvider()) {
        console.log('================================================================================');
        console.log('🧠 Architecture Planner is using ZAI to revise a plan');
        console.log('================================================================================');
        providerPlan = await reviseWithZaiGlm(input);
    } else {
        console.log('================================================================================');
        console.log('⚙️  Architecture Planner is using DETERMINISTIC methods to revise a plan');
        console.log('================================================================================');
        providerPlan = buildDeterministicRevisionFallback(input);
    }

    return {
        planId: input.existingPlan.planId,
        requestId: input.existingPlan.requestId,
        summary: providerPlan.summary,
        affectedFiles: providerPlan.affectedFiles,
        agentAssignments: providerPlan.agentAssignments,
        riskFlags: providerPlan.riskFlags,
        status: 'pending_approval',
    };
};
