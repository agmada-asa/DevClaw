const mockLaunch = jest.fn();
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();

jest.mock('playwright', () => ({
    chromium: {
        launch: (...args: unknown[]) => mockLaunch(...args),
    },
}));

jest.mock('node:fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import { discoverProspects } from '../src/linkedinProspector';

describe('linkedinProspector.discoverProspects', () => {
    const envBackup = { ...process.env };

    let page: any;
    let context: any;
    let browser: any;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envBackup };
        delete process.env.LINKEDIN_EMAIL;
        delete process.env.LINKEDIN_PASSWORD;
        process.env.LINKEDIN_HEADLESS = 'true';
        process.env.CHROMIUM_PATH = '/tmp/chromium';

        page = {
            goto: jest.fn().mockResolvedValue(undefined),
            url: jest.fn().mockReturnValue('https://www.linkedin.com/feed'),
            fill: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockResolvedValue(undefined),
            waitForNavigation: jest.fn().mockResolvedValue(undefined),
            waitForSelector: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn().mockResolvedValue(undefined),
        };

        context = {
            addCookies: jest.fn().mockResolvedValue(undefined),
            newPage: jest.fn().mockResolvedValue(page),
            cookies: jest.fn().mockResolvedValue([{ name: 'li_at', value: 'token' }]),
        };

        browser = {
            newContext: jest.fn().mockResolvedValue(context),
            close: jest.fn().mockResolvedValue(undefined),
        };

        mockLaunch.mockResolvedValue(browser);
        mockReadFile.mockRejectedValue(new Error('no session'));
        mockWriteFile.mockResolvedValue(undefined);
    });

    afterAll(() => {
        process.env = envBackup;
    });

    it('throws when LinkedIn credentials are missing', async () => {
        await expect(discoverProspects({
            query: 'CTO startup software',
            maxResults: 5,
            delayBetweenActionsMs: 1,
        })).rejects.toThrow('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set');
        expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('loads saved cookies and truncates to maxResults deterministically', async () => {
        process.env.LINKEDIN_EMAIL = 'founder@example.com';
        process.env.LINKEDIN_PASSWORD = 'secret';
        mockReadFile.mockResolvedValue(
            JSON.stringify([{ name: 'li_at', value: 'cookie', domain: '.linkedin.com', path: '/' }])
        );

        page.evaluate.mockImplementation(async (_fn: unknown, arg?: unknown) => {
            if (typeof arg === 'string') {
                return [
                    {
                        firstName: 'Ada',
                        lastName: 'Lovelace',
                        title: 'CTO',
                        companyName: 'Analytical Engines',
                        linkedinProfileUrl: 'https://linkedin.com/in/ada',
                        location: 'London',
                        connectionDegree: '2nd',
                    },
                    {
                        firstName: 'Grace',
                        lastName: 'Hopper',
                        title: 'VP Engineering',
                        companyName: 'Compiler Labs',
                        linkedinProfileUrl: 'https://linkedin.com/in/grace',
                        location: 'New York',
                        connectionDegree: '2nd',
                    },
                    {
                        firstName: 'Linus',
                        lastName: 'Torvalds',
                        title: 'Engineering Lead',
                        companyName: 'Kernel Co',
                        linkedinProfileUrl: 'https://linkedin.com/in/linus',
                        location: 'Portland',
                        connectionDegree: '3rd+',
                    },
                    {
                        firstName: 'Ken',
                        lastName: 'Thompson',
                        title: 'Founder',
                        companyName: 'Unix Labs',
                        linkedinProfileUrl: 'https://linkedin.com/in/ken',
                        location: 'San Francisco',
                        connectionDegree: '2nd',
                    },
                ];
            }
            return undefined;
        });

        const results = await discoverProspects({
            query: 'CTO startup software',
            maxResults: 3,
            delayBetweenActionsMs: 1,
        });

        expect(results).toHaveLength(3);
        expect(results.map((r) => r.linkedinProfileUrl)).toEqual([
            'https://linkedin.com/in/ada',
            'https://linkedin.com/in/grace',
            'https://linkedin.com/in/linus',
        ]);
        expect(context.addCookies).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ name: 'li_at' })])
        );
        expect(browser.close).toHaveBeenCalledTimes(1);
    });
});
