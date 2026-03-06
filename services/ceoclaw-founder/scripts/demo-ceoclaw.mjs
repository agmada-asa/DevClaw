#!/usr/bin/env node

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULTS = {
  baseUrl: process.env.CEOCLAW_API_BASE_URL || "http://127.0.0.1:3050",
  searchQuery:
    process.env.CEOCLAW_DEFAULT_SEARCH_QUERY || "CTO startup software",
  maxProspects: Number.parseInt(
    process.env.CEOCLAW_MAX_PROSPECTS_PER_CAMPAIGN || "8",
    10,
  ),
  minFitScore: Number.parseInt(process.env.CEOCLAW_MIN_FIT_SCORE || "65", 10),
  pollMs: Number.parseInt(process.env.CEOCLAW_DEMO_POLL_MS || "5000", 10),
  timeoutMs: Number.parseInt(
    process.env.CEOCLAW_DEMO_TIMEOUT_MS || "420000",
    10,
  ),
  planPrice: Number.parseFloat(process.env.CEOCLAW_DEMO_PLAN_PRICE || "29"),
  outputDir:
    process.env.CEOCLAW_DEMO_OUTPUT_DIR ||
    path.resolve(process.cwd(), "ceoclaw-output", "demo"),
  startupGraceMs: Number.parseInt(
    process.env.CEOCLAW_DEMO_STARTUP_GRACE_MS || "30000",
    10,
  ),
  lowDemoRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_LOW_DEMO_RATE || "0.04",
  ),
  baseDemoRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_BASE_DEMO_RATE || "0.08",
  ),
  highDemoRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_HIGH_DEMO_RATE || "0.16",
  ),
  lowCloseRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_LOW_CLOSE_RATE || "0.20",
  ),
  baseCloseRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_BASE_CLOSE_RATE || "0.30",
  ),
  highCloseRate: Number.parseFloat(
    process.env.CEOCLAW_DEMO_HIGH_CLOSE_RATE || "0.40",
  ),
};

const usage = `
CEOClaw demo script

Usage:
  node scripts/demo-ceoclaw.mjs [options]

Options:
  --base-url <url>         CEOClaw API base URL (default: ${DEFAULTS.baseUrl})
  --campaign-name <name>   Campaign display name
  --search-query <query>   LinkedIn search query
  --max-prospects <n>      Prospect cap for this run
  --min-fit-score <n>      Qualification threshold (0-100)
  --poll-ms <ms>           Campaign polling interval in ms
  --timeout-ms <ms>        Max total wait time in ms
  --startup-grace-ms <ms>  Wait window where "draft" is treated as in-progress
  --discovery-timebox-ms <ms>      Limit discovery stage runtime (optional)
  --qualification-timebox-ms <ms>  Limit qualification stage runtime (optional)
  --message-timebox-ms <ms>        Limit message generation stage runtime (optional)
  --sending-timebox-ms <ms>        Limit send stage runtime (optional)
  --plan-price <amount>    Monthly price used for potential MRR
  --output-dir <path>      Snapshot output directory
  --help                   Show this help

Notes:
  - Assumes CEOClaw service is already running (usually on port 3050).
  - Campaign persistence requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
  - Outreach sending requires valid LinkedIn credentials/session.
  - If message/sending timeboxes are omitted, they inherit --qualification-timebox-ms.
`;

const parseArgs = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "help") {
      options.help = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
};

const toInt = (value, fallback, label) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for ${label}: ${value}`);
  }
  return parsed;
};

const toFloat = (value, fallback, label) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${label}: ${value}`);
  }
  return parsed;
};

const asMoney = (value) => {
  return `£${value.toFixed(2)}`;
};

const requireOk = async (baseUrl, pathname, init = {}) => {
  const url = new URL(pathname, baseUrl).toString();
  const headers = {
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const apiMessage =
      body && typeof body === "object" ? body.error || body.message : null;
    const detail = apiMessage || text || response.statusText;
    throw new Error(
      `${response.status} ${response.statusText} for ${pathname}: ${detail}`,
    );
  }
  return body;
};

const printHeader = (title) => {
  console.log("");
  console.log(`=== ${title} ===`);
};

const nowForName = () => {
  const now = new Date();
  return now.toISOString().replace("T", " ").slice(0, 16);
};

const scenarioProjection = (outreachSent, demoRate, closeRate, planPrice) => {
  const demos = outreachSent * demoRate;
  const customers = demos * closeRate;
  const mrr = customers * planPrice;
  return { demos, customers, mrr };
};

const buildSummary = (prospects = []) => {
  const statusCounts = {
    discovered: 0,
    qualified: 0,
    disqualified: 0,
    message_ready: 0,
    connection_sent: 0,
    messaged: 0,
    replied: 0,
  };

  for (const prospect of prospects) {
    if (
      typeof prospect?.status === "string" &&
      statusCounts[prospect.status] !== undefined
    ) {
      statusCounts[prospect.status] += 1;
    }
  }

  const qualifiedFunnel = prospects.filter((p) =>
    [
      "qualified",
      "message_ready",
      "connection_sent",
      "messaged",
      "replied",
    ].includes(p.status),
  ).length;

  const outreachSent =
    statusCounts.connection_sent + statusCounts.messaged + statusCounts.replied;

  return {
    total: prospects.length,
    qualifiedFunnel,
    outreachSent,
    statusCounts,
  };
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage.trim());
    return;
  }

  const envMessageTimeboxMs = toInt(
    process.env.CEOCLAW_DEMO_MESSAGE_TIMEBOX_MS,
    undefined,
    "CEOCLAW_DEMO_MESSAGE_TIMEBOX_MS",
  );
  const envSendingTimeboxMs = toInt(
    process.env.CEOCLAW_DEMO_SENDING_TIMEBOX_MS,
    undefined,
    "CEOCLAW_DEMO_SENDING_TIMEBOX_MS",
  );
  const discoveryTimeboxMs = toInt(
    args["discovery-timebox-ms"],
    undefined,
    "--discovery-timebox-ms",
  );
  const qualificationTimeboxMs = toInt(
    args["qualification-timebox-ms"],
    undefined,
    "--qualification-timebox-ms",
  );
  const messageTimeboxInput = toInt(
    args["message-timebox-ms"],
    envMessageTimeboxMs,
    "--message-timebox-ms",
  );
  const sendingTimeboxInput = toInt(
    args["sending-timebox-ms"],
    envSendingTimeboxMs,
    "--sending-timebox-ms",
  );

  const config = {
    baseUrl: args["base-url"] || DEFAULTS.baseUrl,
    campaignName: args["campaign-name"] || `CEOClaw Demo ${nowForName()}`,
    searchQuery: args["search-query"] || DEFAULTS.searchQuery,
    maxProspects: toInt(
      args["max-prospects"],
      DEFAULTS.maxProspects,
      "--max-prospects",
    ),
    minFitScore: toInt(
      args["min-fit-score"],
      DEFAULTS.minFitScore,
      "--min-fit-score",
    ),
    pollMs: toInt(args["poll-ms"], DEFAULTS.pollMs, "--poll-ms"),
    timeoutMs: toInt(args["timeout-ms"], DEFAULTS.timeoutMs, "--timeout-ms"),
    startupGraceMs: toInt(
      args["startup-grace-ms"],
      DEFAULTS.startupGraceMs,
      "--startup-grace-ms",
    ),
    discoveryTimeboxMs,
    qualificationTimeboxMs,
    messageTimeboxMs: messageTimeboxInput ?? qualificationTimeboxMs,
    sendingTimeboxMs: sendingTimeboxInput ?? qualificationTimeboxMs,
    planPrice: toFloat(args["plan-price"], DEFAULTS.planPrice, "--plan-price"),
    outputDir: args["output-dir"] || DEFAULTS.outputDir,
    revenueAssumptions: {
      low: { demoRate: DEFAULTS.lowDemoRate, closeRate: DEFAULTS.lowCloseRate },
      base: {
        demoRate: DEFAULTS.baseDemoRate,
        closeRate: DEFAULTS.baseCloseRate,
      },
      high: {
        demoRate: DEFAULTS.highDemoRate,
        closeRate: DEFAULTS.highCloseRate,
      },
    },
  };

  printHeader("CEOClaw Demo Start");
  console.log(`[1/6] Health check at ${config.baseUrl}`);
  const health = await requireOk(config.baseUrl, "/health");
  console.log(
    `Service: ${health.service} | Status: ${health.status} | Engine: ${health.agentEngine}`,
  );

  printHeader("Create Campaign");
  const createPayload = {
    name: config.campaignName,
    searchQuery: config.searchQuery,
    maxProspects: config.maxProspects,
    minFitScore: config.minFitScore,
  };
  const created = await requireOk(config.baseUrl, "/api/campaign", {
    method: "POST",
    body: JSON.stringify(createPayload),
  });
  const campaignId = created?.campaign?.campaignId;
  if (!campaignId) {
    throw new Error(
      "Campaign creation succeeded but no campaignId was returned.",
    );
  }
  console.log(`[2/6] Campaign created: ${campaignId}`);
  console.log(`Name: ${created.campaign.name}`);
  console.log(`Query: ${created.campaign.searchQuery}`);

  printHeader("Run Campaign");
  const runPayload = {
    ...(config.discoveryTimeboxMs !== undefined && {
      discoveryTimeboxMs: config.discoveryTimeboxMs,
    }),
    ...(config.qualificationTimeboxMs !== undefined && {
      qualificationTimeboxMs: config.qualificationTimeboxMs,
    }),
    ...(config.messageTimeboxMs !== undefined && {
      messageTimeboxMs: config.messageTimeboxMs,
    }),
    ...(config.sendingTimeboxMs !== undefined && {
      sendingTimeboxMs: config.sendingTimeboxMs,
    }),
  };
  const runResponse = await requireOk(
    config.baseUrl,
    `/api/campaign/${campaignId}/run`,
    {
      method: "POST",
      body: JSON.stringify(runPayload),
    },
  );
  console.log(
    `[3/6] Campaign run accepted. Polling every ${config.pollMs}ms...`,
  );
  if (runResponse?.progressFile) {
    console.log(`Progress file: ${runResponse.progressFile}`);
  }

  const startedAt = Date.now();
  let campaign = null;
  let liveSummary = null;
  let lastActivity = null;
  let finalProgressStatus = null;
  let finalProgressStage = null;
  let finalProgressActivity = null;
  const progressFile =
    typeof runResponse?.progressFile === "string"
      ? runResponse.progressFile
      : null;
  const terminalStatuses = new Set(["completed", "paused"]);
  while (true) {
    const current = await requireOk(
      config.baseUrl,
      `/api/campaign/${campaignId}`,
    );
    campaign = current?.campaign || null;
    if (!campaign)
      throw new Error(
        "Campaign polling response did not include campaign object.",
      );

    const prospectsLive = await requireOk(
      config.baseUrl,
      `/api/campaign/${campaignId}/prospects`,
    );
    liveSummary = prospectsLive?.summary || null;

    let progressStage = null;
    let progressActivity = null;
    if (progressFile) {
      try {
        const raw = await readFile(progressFile, "utf-8");
        const parsed = JSON.parse(raw);
        finalProgressStatus =
          typeof parsed?.status === "string" ? parsed.status : null;
        progressStage =
          typeof parsed?.currentStage === "string" ? parsed.currentStage : null;
        progressActivity =
          typeof parsed?.currentlyDoing === "string"
            ? parsed.currentlyDoing
            : null;
        finalProgressStage = progressStage;
        finalProgressActivity = progressActivity;
      } catch {
        // Progress file may not exist yet on early polls; ignore and fallback to heuristic.
      }
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const discovered = Number(liveSummary?.discovered || 0);
    const qualified = Number(liveSummary?.qualified || 0);
    const messageReady = Number(liveSummary?.messageReady || 0);
    const connectionSent = Number(liveSummary?.connectionSent || 0);
    const messaged = Number(liveSummary?.messaged || 0);
    const heuristicStage =
      discovered === 0
        ? "discovering"
        : messageReady > 0 || connectionSent > 0 || messaged > 0
          ? "messaging/sending"
          : "qualifying";
    const stageHint = progressStage
      ? progressStage.replaceAll("_", " ")
      : heuristicStage;

    console.log(
      `[poll +${elapsedSec}s] status=${campaign.status} stage=${stageHint} ` +
        `d=${discovered} q=${qualified} ready=${messageReady} sent=${connectionSent + messaged}`,
    );
    if (progressActivity && progressActivity !== lastActivity) {
      console.log(`[poll detail] ${progressActivity}`);
      lastActivity = progressActivity;
    }

    if (terminalStatuses.has(campaign.status)) {
      break;
    }

    // "draft" right after /run can be a race while background execution starts.
    if (
      campaign.status === "draft" &&
      Date.now() - startedAt > config.startupGraceMs
    ) {
      console.log(
        "[poll] Campaign is still draft beyond startup grace. Continuing until timeout.",
      );
    }

    if (Date.now() - startedAt > config.timeoutMs) {
      throw new Error(
        `Timed out after ${config.timeoutMs}ms waiting for campaign completion.`,
      );
    }
    await sleep(config.pollMs);
  }
  console.log(`[4/6] Campaign reached terminal state: ${campaign.status}`);

  const runFailed =
    finalProgressStatus === "failed" ||
    finalProgressStage === "failed" ||
    (typeof finalProgressActivity === "string" &&
      finalProgressActivity.toLowerCase().includes("run failed"));
  if (runFailed) {
    throw new Error(
      finalProgressActivity ||
        "Campaign run failed. Check progress file for details.",
    );
  }

  printHeader("Prospect Outcomes");
  const prospectsResponse = await requireOk(
    config.baseUrl,
    `/api/campaign/${campaignId}/prospects`,
  );
  const prospects = Array.isArray(prospectsResponse?.prospects)
    ? prospectsResponse.prospects
    : [];
  const computed = buildSummary(prospects);
  const outreachSent = Math.max(
    Number(campaign.messagesSent || 0),
    computed.outreachSent,
  );
  const projectionBase =
    outreachSent > 0 ? outreachSent : computed.statusCounts.message_ready;

  console.log(`[5/6] Prospects found: ${computed.total}`);
  console.log(
    `Qualified funnel (qualified or beyond): ${computed.qualifiedFunnel}`,
  );
  console.log(`Outreach sent (connection/message/replied): ${outreachSent}`);
  console.log(`Queued message_ready: ${computed.statusCounts.message_ready}`);
  if (computed.total === 0) {
    console.log(
      "Diagnostic: no prospects were discovered. Check LinkedIn session/login and search query quality.",
    );
  } else if (computed.total > 0 && computed.qualifiedFunnel === 0) {
    console.log(
      "Diagnostic: prospects were found but none qualified. Relax targeting or adjust query/title fit.",
    );
  } else if (computed.statusCounts.message_ready > 0 && outreachSent === 0) {
    console.log(
      "Diagnostic: messages were generated but not sent. Check LinkedIn send permissions/session health.",
    );
  }

  printHeader("Potential Revenue");
  const low = scenarioProjection(
    projectionBase,
    config.revenueAssumptions.low.demoRate,
    config.revenueAssumptions.low.closeRate,
    config.planPrice,
  );
  const base = scenarioProjection(
    projectionBase,
    config.revenueAssumptions.base.demoRate,
    config.revenueAssumptions.base.closeRate,
    config.planPrice,
  );
  const high = scenarioProjection(
    projectionBase,
    config.revenueAssumptions.high.demoRate,
    config.revenueAssumptions.high.closeRate,
    config.planPrice,
  );

  const projectionSource =
    outreachSent > 0 ? "sent outreach" : "queued message_ready leads";
  console.log(
    `[6/6] Revenue projection source: ${projectionBase} ${projectionSource}`,
  );
  console.log(
    `Low  : demos=${low.demos.toFixed(2)} customers=${low.customers.toFixed(2)} potential MRR=${asMoney(low.mrr)}`,
  );
  console.log(
    `Base : demos=${base.demos.toFixed(2)} customers=${base.customers.toFixed(2)} potential MRR=${asMoney(base.mrr)}`,
  );
  console.log(
    `High : demos=${high.demos.toFixed(2)} customers=${high.customers.toFixed(2)} potential MRR=${asMoney(high.mrr)}`,
  );

  const snapshot = {
    generatedAt: new Date().toISOString(),
    config,
    campaign,
    computedSummary: computed,
    projectionSource,
    projectionBase,
    projections: { low, base, high },
    rawProspectSummary: prospectsResponse?.summary || null,
  };

  await mkdir(config.outputDir, { recursive: true });
  const outputPath = path.resolve(
    config.outputDir,
    `ceoclaw-demo-${Date.now()}.json`,
  );
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf-8");

  printHeader("Demo Complete");
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`Snapshot: ${outputPath}`);
};

run().catch((error) => {
  console.error("");
  console.error("[CEOClaw Demo] Failed:", error.message);
  const message = String(error?.message || "");
  if (
    message.includes("LinkedIn login form was not detected") ||
    message.includes("Discovery failed:")
  ) {
    console.error(
      "[CEOClaw Demo] Hint: LinkedIn automation runs in the ceoclaw-founder API process.",
    );
    console.error(
      "[CEOClaw Demo] Set LINKEDIN_HEADLESS and LINKEDIN_MANUAL_LOGIN_TIMEOUT_MS when starting the API server, then re-run demo.",
    );
  }
  process.exit(1);
});
