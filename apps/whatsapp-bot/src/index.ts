import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';

// Initialize the WhatsApp client with LocalAuth to persist session so we don't scan QR every time
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    // Generate QR code in the terminal
    console.log('[WhatsApp] Receive QR code for login. Please scan it with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[WhatsApp] Client is ready!');
});

export const handleMessage = async (message: any) => {
    // Ignore updates from statuses
    if (message.isStatus) return;

    // Ignore messages that are not standard text
    if (message.type !== 'chat') return;

    const text = message.body.trim();
    const isTaskRequest = text.toLowerCase().startsWith('/task ') ||
        text.toLowerCase() === '/task' ||
        text.toLowerCase().startsWith('/request ') ||
        text.toLowerCase() === '/request';

    if (!isTaskRequest) {
        return message.reply('To submit a new request, please start your message with /request or /task followed by your task description.');
    }

    try {
        const contact = await message.getContact();

        const payload = {
            chatId: message.from,
            userId: contact.number,
            username: contact.pushname || contact.name,
            text: text,
            messageId: message.id._serialized,
            timestamp: new Date().toISOString()
        };

        const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001/api/ingress/message';
        const response = await axios.post(GATEWAY_URL, {
            provider: 'whatsapp',
            payload
        });

        if (response.status === 200) {
            await message.reply('Task received and sent to gateway. Evaluating...');
        } else {
            await message.reply('Gateway accepted the message, but returned an unexpected status.');
        }

    } catch (error) {
        console.error('[WhatsApp] Error processing incoming message:', error);
        await message.reply('Failed to forward the message to the central system. Please try again later.');
    }
};

client.on('message', handleMessage);

// For testing purposes, export the client
if (require.main === module) {
    client.initialize().catch(err => {
        console.error('[WhatsApp] Failed to initialize client:', err);
    });

    // Graceful shutdown
    process.once('SIGINT', async () => {
        console.log('[WhatsApp] Shutting down...');
        await client.destroy();
        process.exit(0);
    });
}

export { client };
