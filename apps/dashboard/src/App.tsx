import { useState, useEffect, useCallback, type ReactNode } from 'react';

const API = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskRecord {
  taskId: string;
  requestId: string;
  userId?: string;
  repo?: string;
  description?: string;
  status: 'pending' | 'planning' | 'generating' | 'reviewing' | 'creating_pr' | 'completed' | 'failed' | 'rejected';
  prUrl?: string;
  prNumber?: number;
  iterationsRun?: number;
  qualityScore?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface GatewayStatus {
  status: 'ok' | 'degraded';
  activeTasks: number;
  completedToday: number;
  failedToday: number;
  uptime: number;
}

// ─── GLM model map (mirrors packages/llm-router/src/config.ts) ───────────────

const GLM_ROLES = [
  { role: 'orchestrator',       model: 'glm-4.7',       via: 'OpenRouter', label: 'Workflow Orchestrator', color: 'text-violet-400',  bg: 'bg-violet-950/30 border-violet-800/40' },
  { role: 'planner',            model: 'glm-4.7',       via: 'OpenRouter', label: 'Architecture Planner',  color: 'text-sky-400',     bg: 'bg-sky-950/30 border-sky-800/40'       },
  { role: 'generator',          model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Generator',        color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-800/40' },
  { role: 'reviewer',           model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Reviewer',         color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-800/40' },
  { role: 'frontend_generator', model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Frontend Generator',    color: 'text-teal-400',    bg: 'bg-teal-950/30 border-teal-800/40'   },
  { role: 'backend_generator',  model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Backend Generator',     color: 'text-cyan-400',    bg: 'bg-cyan-950/30 border-cyan-800/40'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusConfig: Record<string, { color: string; dot: string; label: string }> = {
  pending:     { color: 'text-slate-400',   dot: 'bg-slate-500',   label: 'Pending'     },
  planning:    { color: 'text-sky-400',     dot: 'bg-sky-400',     label: 'Planning'    },
  generating:  { color: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Generating'  },
  reviewing:   { color: 'text-violet-400',  dot: 'bg-violet-400',  label: 'Reviewing'   },
  creating_pr: { color: 'text-amber-400',   dot: 'bg-amber-400',   label: 'Creating PR' },
  completed:   { color: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Completed'   },
  failed:      { color: 'text-red-400',     dot: 'bg-red-400',     label: 'Failed'      },
  rejected:    { color: 'text-orange-400',  dot: 'bg-orange-400',  label: 'Rejected'    },
};

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Components ───────────────────────────────────────────────────────────────

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${className}`}>
      {children}
    </span>
  );
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {running && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${running ? 'bg-emerald-400' : 'bg-slate-600'}`} />
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number | ReactNode; sub?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-2xl font-semibold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function TaskRow({ task }: { task: TaskRecord }) {
  const { color: statusColor, dot: statusDot, label: statusLabel } = statusConfig[task.status] ?? statusConfig.pending;
  const isActive = ['pending', 'planning', 'generating', 'reviewing', 'creating_pr'].includes(task.status);

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-800/60 last:border-0">
      <span className="relative flex h-2 w-2 mt-2 flex-shrink-0">
        {isActive && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${statusDot}`} />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${statusDot}`} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200 truncate max-w-xs">
            {task.description ?? task.requestId}
          </span>
          {task.repo && (
            <Pill className="bg-slate-800 text-slate-400 border-slate-700">{task.repo}</Pill>
          )}
          <span className={`ml-auto text-xs font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="flex gap-3 text-xs text-slate-600 mt-0.5 flex-wrap">
          <span>{formatTime(task.startedAt)}</span>
          {task.iterationsRun !== undefined && task.iterationsRun > 0 && (
            <span className="text-slate-500">{task.iterationsRun} iteration{task.iterationsRun !== 1 ? 's' : ''}</span>
          )}
          {task.qualityScore !== undefined && (
            <span className={task.qualityScore >= 80 ? 'text-emerald-500' : 'text-amber-500'}>
              quality {task.qualityScore}/100
            </span>
          )}
          {task.prUrl && (
            <a href={task.prUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 truncate">
              PR #{task.prNumber} ↗
            </a>
          )}
          {task.error && <span className="text-red-400 truncate">{task.error}</span>}
        </div>
      </div>
    </div>
  );
}

function GlmModelCard({ role, model, via, label, color, bg }: typeof GLM_ROLES[0]) {
  return (
    <div className={`border rounded-lg p-3 ${bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-xs font-semibold font-mono ${color}`}>{model}</p>
          <p className="text-xs text-slate-400 mt-0.5">{label}</p>
        </div>
        <span className="text-xs text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 flex-shrink-0">{via}</span>
      </div>
      <p className="text-xs text-slate-600 mt-1.5 font-mono">{role}</p>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, tasksRes] = await Promise.allSettled([
        fetch(`${API}/health`),
        fetch(`${API}/api/tasks/recent?limit=20`),
      ]);

      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const data = await statusRes.value.json();
        setGatewayStatus(data);
      }

      if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
        const data = await tasksRes.value.json();
        setTasks(data.tasks ?? []);
      }

      setError(null);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const si = setInterval(fetchStatus, 5000);
    return () => clearInterval(si);
  }, [fetchStatus]);

  const activeTasks = tasks.filter(t => ['pending', 'planning', 'generating', 'reviewing', 'creating_pr'].includes(t.status));
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const failedTasks = tasks.filter(t => t.status === 'failed');
  const isOnline = gatewayStatus?.status === 'ok';

  return (
    <div className="min-h-screen bg-[#080810] text-slate-300">

      {/* Top nav */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-white font-semibold text-sm tracking-tight">DevClaw</span>
              <span className="text-slate-600 text-sm">/</span>
              <span className="text-slate-400 text-sm">Monitor</span>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 border border-slate-800 rounded-full px-2.5 py-0.5">
              <StatusDot running={isOnline} />
              {isOnline ? 'Gateway online' : 'Gateway offline'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="hidden md:block">Refreshes every 5s</span>
            <span>Updated {timeAgo(lastRefresh.toISOString())}</span>
            {error && (
              <span className="text-red-400 bg-red-950/40 border border-red-800/50 rounded px-2 py-0.5 max-w-xs truncate">{error}</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Active Tasks"
            value={gatewayStatus?.activeTasks ?? activeTasks.length}
            sub="currently running"
          />
          <StatCard
            label="Completed Today"
            value={gatewayStatus?.completedToday ?? completedTasks.length}
            sub="PRs created"
          />
          <StatCard
            label="Failed Today"
            value={gatewayStatus?.failedToday ?? failedTasks.length}
          />
          <StatCard
            label="Gateway"
            value={
              <span className={isOnline ? 'text-emerald-400' : 'text-red-400'}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            }
            sub={gatewayStatus ? `uptime ${Math.floor((gatewayStatus.uptime ?? 0) / 60)}m` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* PR workflow steps */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Agent Pipeline</h2>
                <p className="text-xs text-slate-500 mt-0.5">Telegram → GitHub PR in 4 steps</p>
              </div>
              <div className="space-y-2">
                {[
                  { step: '1', label: 'Plan',        model: 'glm-4.7',      desc: '203k ctx, full repo analysis', color: 'border-sky-800/40 bg-sky-950/20',        text: 'text-sky-400'     },
                  { step: '2', label: 'Generate',    model: 'glm-4.7-flash', desc: 'Writes code patches',         color: 'border-emerald-800/40 bg-emerald-950/20', text: 'text-emerald-400' },
                  { step: '3', label: 'Review',      model: 'glm-4.7-flash', desc: 'Quality scoring + CoT',       color: 'border-emerald-800/40 bg-emerald-950/20', text: 'text-emerald-400' },
                  { step: '4', label: 'Orchestrate', model: 'glm-4.7',      desc: 'Deep reasoning over state',    color: 'border-violet-800/40 bg-violet-950/20',   text: 'text-violet-400'  },
                ].map((s) => (
                  <div key={s.step} className={`flex gap-3 items-start border rounded-lg p-3 ${s.color}`}>
                    <span className="text-xs text-slate-600 font-mono flex-shrink-0 mt-0.5">{s.step}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-200">{s.label}</span>
                        <span className={`text-xs font-mono font-semibold ${s.text}`}>{s.model}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* GLM model map */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Z.AI GLM — Model Map</h2>
                <p className="text-xs text-slate-500 mt-0.5">Three variants matched to cognitive demand.</p>
              </div>
              <div className="space-y-2">
                {GLM_ROLES.map((r) => (
                  <GlmModelCard key={r.role} {...r} />
                ))}
              </div>
            </section>

          </div>

          {/* ── Right column ────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Active tasks */}
            {activeTasks.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-200">Active Tasks</h2>
                  <Pill className="bg-amber-950/40 text-amber-300 border-amber-800/50 animate-pulse">
                    {activeTasks.length} running
                  </Pill>
                </div>
                <div className="max-h-64 overflow-y-auto -mx-1 px-1">
                  {activeTasks.map((task) => (
                    <TaskRow key={task.taskId} task={task} />
                  ))}
                </div>
              </section>
            )}

            {/* Recent task history */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-200">Task History</h2>
                <span className="text-xs text-slate-500">{tasks.length} recent</span>
              </div>
              {tasks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-slate-600">No tasks yet.</p>
                  <p className="text-xs text-slate-700 mt-1">Send a <span className="font-mono">/task</span> message via Telegram to get started.</p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto -mx-1 px-1">
                  {tasks.map((task) => (
                    <TaskRow key={task.taskId} task={task} />
                  ))}
                </div>
              )}
            </section>

            {/* Telegram commands reference */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Telegram Commands</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  { cmd: '/login',               desc: 'Link your GitHub account'      },
                  { cmd: '/repo owner/repo',      desc: 'Set active repository'         },
                  { cmd: '/task <description>',   desc: 'Create a new dev task → PR'    },
                  { cmd: '/approve <id>',         desc: 'Approve the architecture plan' },
                  { cmd: '/reject <id>',          desc: 'Reject and give feedback'      },
                  { cmd: '/refine <notes>',       desc: 'Request code improvements'     },
                  { cmd: '/status',               desc: 'Check your linked repo'        },
                  { cmd: '/repos',                desc: 'List accessible repos'         },
                ].map((c) => (
                  <div key={c.cmd} className="flex gap-2 text-xs border border-slate-800 rounded-md px-3 py-2 bg-slate-800/20">
                    <span className="font-mono text-sky-400 flex-shrink-0">{c.cmd}</span>
                    <span className="text-slate-500">{c.desc}</span>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-600 pb-4">
          <a href={`${API}/health`} target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
            Gateway API · {API}
          </a>
          <span className="text-slate-700">Powered by Z.AI GLM · DevClaw</span>
        </div>
      </main>
    </div>
  );
}
