import { ChatRequest, ChatResponse, ModelRole, chat } from '@devclaw/llm-router';
import { ExecutionSubTask } from './executionPlugin';

type AgentDomain = 'frontend' | 'backend';
type AgentLabel = 'Frontend' | 'Backend';
type GeneratorRole = Extract<ModelRole, 'frontend_generator' | 'backend_generator'>;
type ReviewerRole = Extract<ModelRole, 'frontend_reviewer' | 'backend_reviewer'>;

export type ReviewerDecision = 'APPROVED' | 'REWRITE';

export interface GeneratorRunInput {
    runId: string;
    requestId?: string;
    planId?: string;
    iteration: number;
    subTask: ExecutionSubTask;
    reviewerNotes: string[];
}

export interface GeneratorRunOutput {
    content: string;
    model: string;
    provider: string;
}

export interface ReviewerRunInput {
    runId: string;
    requestId?: string;
    planId?: string;
    iteration: number;
    subTask: ExecutionSubTask;
    generation: GeneratorRunOutput;
}

export interface ReviewerRunOutput {
    decision: ReviewerDecision;
    notes: string[];
    content: string;
    model: string;
    provider: string;
}

export interface GeneratorAgent {
    name: string;
    run(input: GeneratorRunInput): Promise<GeneratorRunOutput>;
}

export interface ReviewerAgent {
    name: string;
    run(input: ReviewerRunInput): Promise<ReviewerRunOutput>;
}

export interface AgentPair {
    domain: AgentDomain;
    agent: AgentLabel;
    generator: GeneratorAgent;
    reviewer: ReviewerAgent;
}

type ChatFn = (request: ChatRequest) => Promise<ChatResponse>;

const asNonEmptyStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 10);
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

const normalizeDecision = (value: unknown): ReviewerDecision => {
    if (typeof value !== 'string') {
        return 'REWRITE';
    }
    return value.trim().toUpperCase() === 'APPROVED' ? 'APPROVED' : 'REWRITE';
};

const parseReviewerDecision = (content: string): { decision: ReviewerDecision; notes: string[] } => {
    const jsonCandidate = extractJsonObject(content);
    if (jsonCandidate) {
        try {
            const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
            const decision = normalizeDecision(parsed.decision);
            const notes = asNonEmptyStringArray(parsed.notes);
            if (notes.length > 0) {
                return { decision, notes };
            }
            return { decision, notes: [content.trim().slice(0, 220)] };
        } catch {
            // Fall through to heuristic parsing.
        }
    }

    const decision = /\bAPPROVED\b/i.test(content) ? 'APPROVED' : 'REWRITE';
    const note = content.trim().slice(0, 220);
    return { decision, notes: note ? [note] : ['Reviewer requested another generator pass.'] };
};

const buildGeneratorMessages = (
    agentName: AgentLabel,
    input: GeneratorRunInput
): ChatRequest['messages'] => {
    const reviewContext = input.reviewerNotes.length > 0
        ? input.reviewerNotes.map((note) => `- ${note}`).join('\n')
        : '- No prior reviewer notes.';

    return [
        {
            role: 'system',
            content: [
                `You are the ${agentName} Generator Agent.`,
                'Produce implementation output for the assigned files.',
                'Return plain text with concrete change instructions and verification notes.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `runId: ${input.runId}`,
                `planId: ${input.planId || 'n/a'}`,
                `subTaskId: ${input.subTask.id}`,
                `iteration: ${input.iteration}`,
                `objective: ${input.subTask.objective}`,
                `files: ${JSON.stringify(input.subTask.files)}`,
                'reviewerNotes:',
                reviewContext,
            ].join('\n'),
        },
    ];
};

const buildReviewerMessages = (
    agentName: AgentLabel,
    input: ReviewerRunInput
): ChatRequest['messages'] => [
        {
            role: 'system',
            content: [
                `You are the ${agentName} Reviewer Agent.`,
                'Assess the generator output and decide if it is ready.',
                'Return JSON only with shape {"decision":"APPROVED|REWRITE","notes":["string"]}.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `runId: ${input.runId}`,
                `planId: ${input.planId || 'n/a'}`,
                `subTaskId: ${input.subTask.id}`,
                `iteration: ${input.iteration}`,
                `objective: ${input.subTask.objective}`,
                `files: ${JSON.stringify(input.subTask.files)}`,
                'generatorOutput:',
                input.generation.content,
            ].join('\n'),
        },
    ];

class LlmGeneratorAgent implements GeneratorAgent {
    constructor(
        public readonly name: string,
        private readonly role: GeneratorRole,
        private readonly agentName: AgentLabel,
        private readonly chatFn: ChatFn
    ) { }

    async run(input: GeneratorRunInput): Promise<GeneratorRunOutput> {
        const response = await this.chatFn({
            role: this.role,
            requestId: input.requestId,
            messages: buildGeneratorMessages(this.agentName, input),
        });

        return {
            content: response.content,
            model: response.model,
            provider: response.provider,
        };
    }
}

class LlmReviewerAgent implements ReviewerAgent {
    constructor(
        public readonly name: string,
        private readonly role: ReviewerRole,
        private readonly agentName: AgentLabel,
        private readonly chatFn: ChatFn
    ) { }

    async run(input: ReviewerRunInput): Promise<ReviewerRunOutput> {
        const response = await this.chatFn({
            role: this.role,
            requestId: input.requestId,
            messages: buildReviewerMessages(this.agentName, input),
            temperature: 0,
        });

        const parsed = parseReviewerDecision(response.content);
        return {
            decision: parsed.decision,
            notes: parsed.notes,
            content: response.content,
            model: response.model,
            provider: response.provider,
        };
    }
}

export interface AgentPairFactory {
    createPair(): AgentPair;
}

export class FrontendAgentFactory implements AgentPairFactory {
    constructor(private readonly chatFn: ChatFn = chat) { }

    createPair(): AgentPair {
        return {
            domain: 'frontend',
            agent: 'Frontend',
            generator: new LlmGeneratorAgent(
                'FrontendGenerator',
                'frontend_generator',
                'Frontend',
                this.chatFn
            ),
            reviewer: new LlmReviewerAgent(
                'FrontendReviewer',
                'frontend_reviewer',
                'Frontend',
                this.chatFn
            ),
        };
    }
}

export class BackendAgentFactory implements AgentPairFactory {
    constructor(private readonly chatFn: ChatFn = chat) { }

    createPair(): AgentPair {
        return {
            domain: 'backend',
            agent: 'Backend',
            generator: new LlmGeneratorAgent(
                'BackendGenerator',
                'backend_generator',
                'Backend',
                this.chatFn
            ),
            reviewer: new LlmReviewerAgent(
                'BackendReviewer',
                'backend_reviewer',
                'Backend',
                this.chatFn
            ),
        };
    }
}

export class AgentPairFactoryRegistry {
    private readonly frontendFactory: AgentPairFactory;
    private readonly backendFactory: AgentPairFactory;

    constructor(options?: {
        frontendFactory?: AgentPairFactory;
        backendFactory?: AgentPairFactory;
    }) {
        this.frontendFactory = options?.frontendFactory || new FrontendAgentFactory();
        this.backendFactory = options?.backendFactory || new BackendAgentFactory();
    }

    createPair(domain: AgentDomain): AgentPair {
        if (domain === 'frontend') {
            return this.frontendFactory.createPair();
        }
        return this.backendFactory.createPair();
    }
}

