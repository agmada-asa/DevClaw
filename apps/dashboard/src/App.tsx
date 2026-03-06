import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_CEOCLAW_API_URL ?? 'http://localhost:3050';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoopStatus {
  running: boolean;
  intervalMs: number;
  iterationsRun: number;
  lastIterationAt?: string;
  lastTaskType?: string;
  lastTaskStatus?: string;
  currentMrr: number;
  mrrGoal: number;
  mrrProgress: string;
  phase: string;
}

interface TaskRecord {
  taskId: string;
  taskType: string;
  domain: string;
  status: 'running' | 'completed' | 'failed';
  reason?: string;
  priority?: string;
  mrrAtTime?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  output?: Record<string, unknown>;
}

// ─── GLM model map (mirrors packages/llm-router/src/config.ts) ───────────────
// Three Z.AI GLM models, each via the best available path:
//   glm-4.7-flash  → direct Z.AI API  (generation / review / outreach)
//   glm-z1-flash   → OpenRouter       (reasoning: orchestration / qualification)
//   glm-4-long     → OpenRouter       (128k ctx: architecture planning)

const GLM_ROLES = [
  { role: 'orchestrator',       model: 'glm-z1-flash',  via: 'OpenRouter', label: 'Workflow Orchestrator',   color: 'text-purple-400' },
  { role: 'planner',            model: 'glm-4-long',    via: 'OpenRouter', label: 'Architecture Planner',    color: 'text-blue-400'   },
  { role: 'generator',          model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Generator',          color: 'text-green-400'  },
  { role: 'reviewer',           model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Reviewer',           color: 'text-green-400'  },
  { role: 'prospect_qualifier', model: 'glm-z1-flash',  via: 'OpenRouter', label: 'Prospect Qualifier',      color: 'text-purple-400' },
  { role: 'outreach_writer',    model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Outreach Writer',         color: 'text-yellow-400' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const domainColor: Record<string, string> = {
  product: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  marketing: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  sales: 'bg-green-900/40 text-green-300 border-green-700/50',
  operations: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
};

const statusColor: Record<string, string> = {
  completed: 'text-green-400',
  failed: 'text-red-400',
  running: 'text-yellow-400',
};

const phaseColor: Record<string, string> = {
  'pre-launch': 'text-gray-400',
  launched: 'text-blue-400',
  growth: 'text-green-400',
  scaling: 'text-purple-400',
};

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusDot({ running }: { running: boolean }) {
  return (
    <span className="relative flex h-3 w-3">
      {running && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${running ? 'bg-green-400' : 'bg-gray-600'}`} />
    </span>
  );
}

function MrrBar({ current, goal }: { current: number; goal: number }) {
  const pct = Math.min(100, goal > 0 ? Math.round((current / goal) * 100) : 0);
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>MRR Progress</span>
        <span>${current} / ${goal}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs text-gray-500 mt-1">{pct}%</div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskRecord }) {
  const domain = task.domain ?? task.taskType.split('.')[0] ?? 'operations';
  const domainClass = domainColor[domain] ?? domainColor.operations;
  const statusClass = statusColor[task.status] ?? 'text-gray-400';

  return (
    <div className="border border-gray-800 rounded-lg p-3 space-y-1 bg-gray-900/40">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded border ${domainClass}`}>
          {domain}
        </span>
        <span className="text-sm font-medium text-gray-200">{task.taskType}</span>
        <span className={`ml-auto text-xs ${statusClass}`}>{task.status}</span>
      </div>
      {task.reason && (
        <p className="text-xs text-gray-500 leading-relaxed">{task.reason}</p>
      )}
      <div className="flex gap-4 text-xs text-gray-600">
        <span>{formatTime(task.startedAt)}</span>
        {task.mrrAtTime !== undefined && <span>MRR at time: ${task.mrrAtTime}</span>}
        {task.error && <span className="text-red-500">{task.error}</span>}
      </div>
    </div>
  );
}

function GlmModelCard({ role, model, via, label, color }: typeof GLM_ROLES[0]) {
  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/30">
      <div className="flex items-center justify-between">
        <div className={`text-xs font-semibold ${color}`}>{model}</div>
        <span className="text-xs text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">{via}</span>
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
      <div className="text-xs text-gray-700 mt-1 font-mono">{role}</div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [loop, setLoop] = useState<LoopStatus | null>(null);
  const [history, setHistory] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, histRes] = await Promise.all([
        fetch(`${API}/api/loop/status`),
        fetch(`${API}/api/loop/history?limit=20`),
      ]);
      if (!statusRes.ok) throw new Error(`Status ${statusRes.status}`);
      const statusData = await statusRes.json();
      setLoop(statusData.loop);
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData.history ?? []);
      }
      setError(null);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const action = async (endpoint: string, label: string) => {
    setActionLoading(label);
    try {
      const res = await fetch(`${API}${endpoint}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-white">DevClaw</span>
            <span className="text-gray-500 mx-2">/</span>
            <span className="text-cyan-400">Agent Dashboard</span>
          </h1>
          <p className="text-xs text-gray-600 mt-0.5">Powered by Z.AI GLM — glm-4.7-flash · glm-z1-flash · glm-4-long</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>Refreshed {timeAgo(lastRefresh.toISOString())}</span>
          {error && <span className="text-red-400 border border-red-900 rounded px-2 py-0.5">{error}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column: CEOClaw controls + status */}
        <div className="lg:col-span-1 space-y-4">

          {/* Loop status card */}
          <div className="border border-gray-800 rounded-xl p-4 bg-gray-900/30 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">CEOClaw Loop</h2>
              <div className="flex items-center gap-2">
                <StatusDot running={loop?.running ?? false} />
                <span className="text-xs text-gray-400">{loop?.running ? 'running' : 'idle'}</span>
              </div>
            </div>

            {loop && (
              <>
                <MrrBar current={loop.currentMrr} goal={loop.mrrGoal} />

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <div className="text-gray-500">Phase</div>
                    <div className={`font-semibold mt-0.5 ${phaseColor[loop.phase] ?? 'text-gray-300'}`}>{loop.phase}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <div className="text-gray-500">Iterations</div>
                    <div className="font-semibold text-gray-200 mt-0.5">{loop.iterationsRun}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <div className="text-gray-500">Last Task</div>
                    <div className="font-semibold text-gray-200 mt-0.5 truncate">{loop.lastTaskType?.split('.')[1] ?? '—'}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-2">
                    <div className="text-gray-500">Last Run</div>
                    <div className="font-semibold text-gray-200 mt-0.5">{timeAgo(loop.lastIterationAt)}</div>
                  </div>
                </div>
              </>
            )}

            {/* Controls */}
            <div className="flex gap-2">
              {!loop?.running ? (
                <button
                  onClick={() => action('/api/loop/start', 'start')}
                  disabled={actionLoading !== null}
                  className="flex-1 text-xs bg-green-900/50 hover:bg-green-800/60 border border-green-700/50 text-green-300 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'start' ? 'Starting...' : 'Start Loop'}
                </button>
              ) : (
                <button
                  onClick={() => action('/api/loop/stop', 'stop')}
                  disabled={actionLoading !== null}
                  className="flex-1 text-xs bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 text-red-300 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'stop' ? 'Stopping...' : 'Stop Loop'}
                </button>
              )}
              <button
                onClick={() => action('/api/loop/tick', 'tick')}
                disabled={actionLoading !== null}
                className="flex-1 text-xs bg-blue-900/50 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'tick' ? 'Running...' : 'Run One Tick'}
              </button>
            </div>
          </div>

          {/* Z.AI GLM model map */}
          <div className="border border-gray-800 rounded-xl p-4 bg-gray-900/30 space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">Z.AI GLM — Model Map</h2>
            <p className="text-xs text-gray-600">Three GLM variants, each matched to its role. Direct Z.AI API for generation; OpenRouter for reasoning and long-context planning.</p>
            <div className="grid grid-cols-1 gap-2">
              {GLM_ROLES.map((r) => (
                <GlmModelCard key={r.role} {...r} />
              ))}
            </div>
          </div>
        </div>

        {/* Right column: task history */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-gray-800 rounded-xl p-4 bg-gray-900/30">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300">Agent Task History</h2>
              <span className="text-xs text-gray-600">{history.length} recent tasks</span>
            </div>

            {history.length === 0 ? (
              <div className="text-center py-12 text-gray-600">
                <div className="text-2xl mb-2">⚡</div>
                <p className="text-sm">No tasks yet. Start the loop or run a tick to see GLM in action.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
                {history.map((task) => (
                  <TaskRow key={task.taskId} task={task} />
                ))}
              </div>
            )}
          </div>

          {/* DevClaw workflow legend */}
          <div className="border border-gray-800 rounded-xl p-4 bg-gray-900/30">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">DevClaw — PR Workflow (GLM-Powered)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {[
                { step: '1. Plan', model: 'glm-4-long', desc: '128k ctx, full codebase read', color: 'border-blue-700/40 bg-blue-900/20' },
                { step: '2. Generate', model: 'glm-4.7-flash', desc: 'Writes code patches', color: 'border-green-700/40 bg-green-900/20' },
                { step: '3. Review', model: 'glm-4.7-flash', desc: 'Checks correctness & quality', color: 'border-green-700/40 bg-green-900/20' },
                { step: '4. Orchestrate', model: 'glm-z1-flash', desc: 'Deep CoT over workflow state', color: 'border-purple-700/40 bg-purple-900/20' },
              ].map((s) => (
                <div key={s.step} className={`border rounded-lg p-2 ${s.color}`}>
                  <div className="font-semibold text-gray-300">{s.step}</div>
                  <div className="text-cyan-400 mt-0.5">{s.model}</div>
                  <div className="text-gray-500 mt-0.5">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
