// Shared types used across orchestrator modules.
// When adding a new messaging channel, add it here — notifier.ts BOT_URL map
// and index.ts channel validation both depend on this union.
export type Channel = 'telegram' | 'whatsapp';
