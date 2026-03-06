/**
 * testSend.ts — Quick one-off test to verify the LinkedIn sending pipeline.
 *
 * Usage:
 *   npx ts-node src/testSend.ts
 *
 * Sends a connection request with a note to the target profile defined below.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { sendOutreachBatch } from './linkedinMessenger';

const TARGET_PROFILE_URL = 'https://www.linkedin.com/in/mideyy7/';

const TEST_MESSAGE =
    "Hey Ayomide — this is a test of the CEOClaw automated outreach pipeline. " +
    "If you're reading this, the connection request + note worked! 🎉 " +
    "DevClaw: describe your feature, get production-ready code.";

(async () => {
    console.log('[TestSend] Starting test send to:', TARGET_PROFILE_URL);

    const results = await sendOutreachBatch([
        {
            prospectId: 'test-001',
            profileUrl: TARGET_PROFILE_URL,
            message: TEST_MESSAGE,
            firstName: 'Ayomide',
            lastName: 'Ojediran',
            connectionDegree: '1st', // Already connected — use direct message flow
        },
    ]);

    for (const r of results) {
        if (r.sent) {
            console.log(`[TestSend] ✅ Sent! Method: ${r.method}`);
        } else {
            console.log(`[TestSend] ❌ Not sent. Method: ${r.method}. Error: ${r.error || 'none'}`);
        }
    }
})();
