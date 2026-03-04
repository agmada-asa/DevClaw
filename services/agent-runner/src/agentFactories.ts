import { ChatRequest, ChatResponse, ModelRole, chat } from '@devclaw/llm-router';
import { ExecutionSubTask } from './executionPlugin';

type AgentDomain = 'frontend' | 'backend';
type AgentLabel = 'Frontend' | 'Backend';
type GeneratorRole = Extract<ModelRole, 'frontend_generator' | 'backend_generator'>;
type ReviewerRole = Extract<ModelRole, 'frontend_reviewer' | 'backend_reviewer'>;

export type ReviewerDecision = 'APPROVED' | 'REWRITE';

export interface WorkspaceFileSnapshot {
    path: string;
    exists: boolean;
    content: string;
    truncated: boolean;
}

export interface GeneratorRunInput {
    runId: string;
    requestId?: string;
    planId?: string;
    iteration: number;
    subTask: ExecutionSubTask;
    reviewerNotes: string[];
    workspacePath?: string;
    executionBranchName?: string;
    fileSnapshots?: WorkspaceFileSnapshot[];
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
    workspacePath?: string;
    executionBranchName?: string;
    proposedPatch?: string;
    workspaceDiff?: string;
    fileSnapshots?: WorkspaceFileSnapshot[];
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
    let cleanText = text.trim();
    if (cleanText.toLowerCase().startsWith('```json')) {
        cleanText = cleanText.substring(7).trim();
    } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.substring(3).trim();
    }

    if (cleanText.endsWith('```')) {
        cleanText = cleanText.substring(0, cleanText.length - 3).trim();
    }

    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end > start) {
        return cleanText.slice(start, end + 1).trim();
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

    const workspaceContext = [
        `workspacePath: ${input.workspacePath || 'n/a'}`,
        `executionBranch: ${input.executionBranchName || 'n/a'}`,
        `targetFiles: ${JSON.stringify(input.subTask.files)}`,
        'fileSnapshots:',
        JSON.stringify(input.fileSnapshots || [], null, 2),
    ].join('\n');

    return [
        {
            role: 'system',
            content: [
                `You are the ${agentName} Generator Agent.`,
                'Implement the requested code changes directly against the provided repository snapshots.',
                'You MUST output your response as a SINGLE, valid JSON object.',
                'The JSON object must have this exact shape:',
                '{',
                '  "summary": "String explaining the changes",',
                '  "notes": ["String array of architectural or important notes"],',
                '  "files": [',
                '    {',
                '      "path": "relative/path/to/file.ext",',
                '      "content": "Full, complete file content here. Do not use file diffs or patches, just an entire rewrite. Do not truncate or use placeholders. Must be the entire file content."',
                '    }',
                '  ]',
                '}',
                'Do not include any text outside the JSON object.',
                'Keep changes scoped to the assigned files unless absolutely necessary.',
                'CRITICAL: DO NOT try to generate contents for binary files or non-text files (e.g., .ico, .png, .jpg, .svg). If a non-text file is required, mention it in the "notes" array instead of generating it.',
                'CRITICAL: To avoid exceeding the max_tokens limit, ensure your overall JSON response is concise. Do not generate unnecessarily large files if they are not strictly required.',
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
                workspaceContext,
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
                `workspacePath: ${input.workspacePath || 'n/a'}`,
                `executionBranch: ${input.executionBranchName || 'n/a'}`,
                'fileSnapshots:',
                JSON.stringify(input.fileSnapshots || [], null, 2),
                'generatorOutput:',
                input.generation.content,
                'proposedPatch:',
                input.proposedPatch || 'n/a',
                'workspaceDiffAfterPatch:',
                input.workspaceDiff || 'n/a',
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
