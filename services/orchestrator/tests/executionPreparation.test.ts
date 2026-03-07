import { ArchitecturePlan } from '@devclaw/contracts';
import {
    buildExecutionSubTasks,
    resolvePreferredExecutionBranch,
} from '../src/executionPreparation';

describe('executionPreparation', () => {
    it('falls back to a generated branch name when blueprint branch name is a placeholder', () => {
        const result = resolvePreferredExecutionBranch({
            blueprint: {
                branch: {
                    name: 'unknown',
                    baseBranch: 'main',
                },
            },
        }, 'plan-123', 'Fix login flow');

        expect(result).toEqual({
            branchName: 'devclaw/fix-123-fix-login-flow',
            baseBranch: 'main',
        });
    });

    it('falls back to main when blueprint base branch is a placeholder', () => {
        const result = resolvePreferredExecutionBranch({
            blueprint: {
                branch: {
                    name: 'devclaw/fix-123-fix-login-flow',
                    baseBranch: 'unknown',
                },
            },
        }, 'plan-123', 'Fix login flow');

        expect(result).toEqual({
            branchName: 'devclaw/fix-123-fix-login-flow',
            baseBranch: 'main',
        });
    });

    it('does not append unknown files to a scoped frontend subtask when domain files already exist', () => {
        const plan: ArchitecturePlan = {
            planId: 'plan-123',
            requestId: 'req-123',
            summary: 'Create portfolio site',
            affectedFiles: ['apps/web/src/App.tsx', 'README.md'],
            agentAssignments: [
                { domain: 'frontend', generator: 'FrontendGenerator', reviewer: 'FrontendReviewer' },
            ],
            riskFlags: [],
            status: 'approved',
        };

        expect(buildExecutionSubTasks(plan)).toEqual([
            {
                id: 'plan-123-frontend',
                domain: 'frontend',
                agent: 'Frontend',
                objective: 'Create portfolio site',
                files: ['apps/web/src/App.tsx'],
                generator: 'FrontendGenerator',
                reviewer: 'FrontendReviewer',
            },
        ]);
    });

    it('keeps unknown files when they are the only files available for an assigned domain', () => {
        const plan: ArchitecturePlan = {
            planId: 'plan-456',
            requestId: 'req-456',
            summary: 'Refresh project docs',
            affectedFiles: ['README.md'],
            agentAssignments: [
                { domain: 'frontend', generator: 'FrontendGenerator', reviewer: 'FrontendReviewer' },
            ],
            riskFlags: [],
            status: 'approved',
        };

        expect(buildExecutionSubTasks(plan)).toEqual([
            {
                id: 'plan-456-frontend',
                domain: 'frontend',
                agent: 'Frontend',
                objective: 'Refresh project docs',
                files: ['README.md'],
                generator: 'FrontendGenerator',
                reviewer: 'FrontendReviewer',
            },
        ]);
    });
});
