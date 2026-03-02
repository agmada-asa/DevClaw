import { ArchitecturePlan } from '@devclaw/contracts';
import { OpenClawExecutionBlueprint, OpenClawPlanRecord } from './types';

export interface SaveNewPlanInput {
    plan: ArchitecturePlan;
    source: string;
    blueprint: OpenClawExecutionBlueprint;
}

export interface SavePlanRevisionInput {
    planId: string;
    plan: ArchitecturePlan;
    source: string;
    reason: string;
    blueprint: OpenClawExecutionBlueprint;
}

class InMemoryPlanStore {
    private readonly plans = new Map<string, OpenClawPlanRecord>();

    saveNewPlan(input: SaveNewPlanInput): OpenClawPlanRecord {
        const now = new Date().toISOString();
        const existing = this.plans.get(input.plan.planId);

        if (existing) {
            return this.savePlanRevision({
                planId: input.plan.planId,
                plan: input.plan,
                source: input.source,
                reason: 'Plan regenerated from create endpoint',
                blueprint: input.blueprint,
            }) as OpenClawPlanRecord;
        }

        const created: OpenClawPlanRecord = {
            plan: input.plan,
            revision: 1,
            source: input.source,
            createdAt: now,
            updatedAt: now,
            revisionHistory: [
                {
                    revision: 1,
                    updatedAt: now,
                    reason: 'Initial architecture plan created',
                    source: input.source,
                },
            ],
            blueprint: input.blueprint,
        };

        this.plans.set(input.plan.planId, created);
        return created;
    }

    getPlan(planId: string): OpenClawPlanRecord | null {
        return this.plans.get(planId) || null;
    }

    savePlanRevision(input: SavePlanRevisionInput): OpenClawPlanRecord | null {
        const existing = this.plans.get(input.planId);
        if (!existing) return null;

        const now = new Date().toISOString();
        const revision = existing.revision + 1;

        const updated: OpenClawPlanRecord = {
            ...existing,
            plan: input.plan,
            source: input.source,
            revision,
            updatedAt: now,
            revisionHistory: [
                ...existing.revisionHistory,
                {
                    revision,
                    updatedAt: now,
                    reason: input.reason,
                    source: input.source,
                },
            ],
            blueprint: input.blueprint,
        };

        this.plans.set(input.planId, updated);
        return updated;
    }
}

let storeInstance: InMemoryPlanStore | null = null;

export const getPlanStore = (): InMemoryPlanStore => {
    if (!storeInstance) {
        storeInstance = new InMemoryPlanStore();
    }
    return storeInstance;
};
