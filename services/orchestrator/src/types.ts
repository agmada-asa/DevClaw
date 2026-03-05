// Shared types used across orchestrator modules.
// When adding a new messaging channel, add it here — notifier.ts BOT_URL map
// and index.ts channel validation both depend on this union.
export type Channel = 'telegram' | 'whatsapp';

// Result returned by sendToUser and sendChangeSummary.
// ok: true  — message was delivered successfully.
// ok: false — delivery failed; reason explains why so callers can log or
//             persist a "notification pending" record in Supabase for re-delivery.
export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'no_bot_url' | 'send_failed'; error?: string };
