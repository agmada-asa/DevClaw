import { resolvePreferredExecutionBranch } from '../src/executionPreparation';

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
});
