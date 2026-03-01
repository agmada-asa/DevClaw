import { client } from '../src/index';

describe('WhatsApp Client initialization', () => {
    it('should create a valid client instance', () => {
        expect(client).toBeDefined();
        // In actual tests, you'd likely want to mock whatsapp-web.js entirely
        // given how heavily it relies on Puppeteer.
    });
});
