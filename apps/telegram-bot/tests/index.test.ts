import { bot } from '../src/index';

describe('Telegram Bot initialization', () => {
    it('should create a valid telegraf instance', () => {
        // This is a minimal test to ensure the module doesn't crash on import
        // Note that the TELEGRAM_BOT_TOKEN must be set or mocked prior
        expect(bot).toBeDefined();
    });
});
