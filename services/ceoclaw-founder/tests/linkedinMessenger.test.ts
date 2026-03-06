const mockLaunch = jest.fn();
const mockReadFile = jest.fn();

jest.mock('playwright', () => ({
    chromium: {
        launch: (...args: unknown[]) => mockLaunch(...args),
    },
}));

jest.mock('node:fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { sendOutreachBatch } from '../src/linkedinMessenger';

const makeLocator = () => {
    const locator: any = {};
    locator.first = jest.fn(() => locator);
    locator.nth = jest.fn(() => locator);
    locator.isVisible = jest.fn().mockResolvedValue(true);
    locator.click = jest.fn().mockResolvedValue(undefined);
    locator.pressSequentially = jest.fn().mockResolvedValue(undefined);
    locator.textContent = jest.fn().mockResolvedValue('Typed message');
    locator.press = jest.fn().mockResolvedValue(undefined);
    locator.count = jest.fn().mockResolvedValue(0);
    locator.evaluate = jest.fn().mockResolvedValue(false);
    return locator;
};

describe('linkedinMessenger.sendOutreachBatch', () => {
    const envBackup = { ...process.env };

    let page: any;
    let context: any;
    let browser: any;
    let locators: Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...envBackup };
        delete process.env.LINKEDIN_EMAIL;
        delete process.env.LINKEDIN_PASSWORD;
        process.env.CEOCLAW_DAILY_MESSAGE_LIMIT = '1';
        process.env.CEOCLAW_DELAY_BETWEEN_ACTIONS_MS = '1';
        process.env.LINKEDIN_HEADLESS = 'true';

        locators = {};
        page = {
            goto: jest.fn().mockResolvedValue(undefined),
            url: jest.fn().mockReturnValue('https://www.linkedin.com/feed'),
            waitForSelector: jest.fn().mockResolvedValue(undefined),
            evaluate: jest.fn(),
            locator: jest.fn((selector: string) => {
                if (!locators[selector]) locators[selector] = makeLocator();
                return locators[selector];
            }),
        };

        context = {
            addCookies: jest.fn().mockResolvedValue(undefined),
            newPage: jest.fn().mockResolvedValue(page),
        };

        browser = {
            newContext: jest.fn().mockResolvedValue(context),
            close: jest.fn().mockResolvedValue(undefined),
        };

        mockLaunch.mockResolvedValue(browser);
        mockReadFile.mockResolvedValue(
            JSON.stringify([{ name: 'li_at', value: 'cookie', domain: '.linkedin.com', path: '/' }])
        );
    });

    afterAll(() => {
        process.env = envBackup;
    });

    it('throws when LinkedIn credentials are missing', async () => {
        await expect(sendOutreachBatch([
            {
                prospectId: 'p1',
                profileUrl: 'https://linkedin.com/in/p1',
                message: 'hello',
                connectionDegree: '1st',
            },
        ])).rejects.toThrow('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set');
    });

    it('respects daily limit and sends direct messages for 1st-degree targets', async () => {
        process.env.LINKEDIN_EMAIL = 'founder@example.com';
        process.env.LINKEDIN_PASSWORD = 'secret';

        let evalCall = 0;
        page.evaluate.mockImplementation(async () => {
            evalCall += 1;
            if (evalCall === 1) {
                return 'https://www.linkedin.com/messaging/compose/?profileUrn=abc';
            }
            return [
                { i: 0, text: 'Send', aria: 'Send', type: 'submit', disabled: false },
            ];
        });

        const results = await sendOutreachBatch([
            {
                prospectId: 'p1',
                profileUrl: 'https://linkedin.com/in/p1',
                message: 'Hello there',
                connectionDegree: '1st',
            },
            {
                prospectId: 'p2',
                profileUrl: 'https://linkedin.com/in/p2',
                message: 'Second target should be skipped by daily limit',
                connectionDegree: '1st',
            },
        ]);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual(expect.objectContaining({
            prospectId: 'p1',
            sent: true,
            method: 'direct_message',
        }));
        expect(context.addCookies).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ name: 'li_at' })])
        );
        expect(browser.close).toHaveBeenCalledTimes(1);
    }, 20_000);
});
