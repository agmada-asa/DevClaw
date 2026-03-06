import { useState, useEffect, useCallback, type ReactNode } from 'react';

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

interface Campaign {
  campaignId: string;
  name: string;
  searchQuery: string;
  status: string;
  prospectsFound: number;
  prospectsQualified: number;
  messagesGenerated: number;
  messagesSent: number;
  replies: number;
  createdAt: string;
}

interface ProspectSummary {
  total: number;
  discovered?: number;
  qualified?: number;
  messageReady?: number;
  connectionSent?: number;
  messaged?: number;
  replied?: number;
}

// ─── GLM model map (mirrors packages/llm-router/src/config.ts) ───────────────

const GLM_ROLES = [
  { role: 'orchestrator',       model: 'glm-z1-flash',  via: 'OpenRouter', label: 'Workflow Orchestrator',   color: 'text-violet-400',  bg: 'bg-violet-950/30 border-violet-800/40' },
  { role: 'planner',            model: 'glm-4-long',    via: 'OpenRouter', label: 'Architecture Planner',    color: 'text-sky-400',     bg: 'bg-sky-950/30 border-sky-800/40'       },
  { role: 'generator',          model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Generator',          color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-800/40' },
  { role: 'reviewer',           model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Code Reviewer',           color: 'text-emerald-400', bg: 'bg-emerald-950/30 border-emerald-800/40' },
  { role: 'prospect_qualifier', model: 'glm-z1-flash',  via: 'OpenRouter', label: 'Prospect Qualifier',      color: 'text-violet-400',  bg: 'bg-violet-950/30 border-violet-800/40' },
  { role: 'outreach_writer',    model: 'glm-4.7-flash', via: 'Z.AI API',   label: 'Outreach Writer',         color: 'text-amber-400',   bg: 'bg-amber-950/30 border-amber-800/40'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const domainColor: Record<string, string> = {
  product:    'bg-sky-900/30 text-sky-300 border-sky-700/40',
  marketing:  'bg-amber-900/30 text-amber-300 border-amber-700/40',
  sales:      'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
  operations: 'bg-violet-900/30 text-violet-300 border-violet-700/40',
};

const statusConfig: Record<string, { color: string; dot: string }> = {
  completed: { color: 'text-emerald-400', dot: 'bg-emerald-400' },
  failed:    { color: 'text-red-400',     dot: 'bg-red-400'     },
  running:   { color: 'text-amber-400',   dot: 'bg-amber-400'   },
};

const campaignStatusBadge: Record<string, string> = {
  draft:     'bg-slate-800 text-slate-400 border-slate-700',
  running:   'bg-amber-950/40 text-amber-300 border-amber-800/50',
  paused:    'bg-slate-800 text-slate-400 border-slate-700',
  completed: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  failed:    'bg-red-950/40 text-red-400 border-red-800/50',
};

const phaseConfig: Record<string, { color: string; label: string }> = {
  'pre-launch': { color: 'text-slate-400',   label: 'Pre-Launch'  },
  launched:     { color: 'text-sky-400',     label: 'Launched'    },
  growth:       { color: 'text-emerald-400', label: 'Growth'      },
  scaling:      { color: 'text-violet-400',  label: 'Scaling'     },
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

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
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

function MrrBar({ current, goal }: { current: number; goal: number }) {
  const pct = Math.min(100, goal > 0 ? Math.round((current / goal) * 100) : 0);
  const barColor = pct >= 100 ? 'from-emerald-500 to-teal-400'
    : pct >= 60 ? 'from-sky-500 to-cyan-400'
    : 'from-violet-500 to-indigo-400';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-400 font-medium">MRR Progress</span>
        <span className="text-white font-semibold tabular-nums">${current} <span className="text-slate-500 font-normal">/ ${goal}</span></span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full bg-gradient-to-r ${barColor} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-right text-xs text-slate-500">{pct}% of ${goal} goal</p>
    </div>
  );
}

function TaskRow({ task }: { task: TaskRecord }) {
  const domain = task.domain ?? task.taskType.split('.')[0] ?? 'operations';
  const domainClass = domainColor[domain] ?? domainColor.operations;
  const { color: statusColor, dot: statusDot } = statusConfig[task.status] ?? { color: 'text-slate-400', dot: 'bg-slate-400' };
  const taskName = task.taskType.split('.')[1] ?? task.taskType;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-800/60 last:border-0">
      <div className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200 capitalize">{taskName.replace(/_/g, ' ')}</span>
          <Pill className={domainClass}>{domain}</Pill>
          {task.priority && task.priority !== 'medium' && (
            <Pill className={task.priority === 'high' ? 'bg-red-950/40 text-red-300 border-red-800/40' : 'bg-slate-800 text-slate-400 border-slate-700'}>
              {task.priority}
            </Pill>
          )}
          <span className={`ml-auto text-xs ${statusColor}`}>{task.status}</span>
        </div>
        {task.reason && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-1">{task.reason}</p>
        )}
        <div className="flex gap-3 text-xs text-slate-600 mt-0.5">
          <span>{formatTime(task.startedAt)}</span>
          {task.mrrAtTime !== undefined && <span>MRR ${task.mrrAtTime}</span>}
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

function ActionButton({
  onClick, disabled, loading, loadingLabel, label, variant,
}: {
  onClick: () => void; disabled: boolean; loading: boolean;
  loadingLabel: string; label: string; variant: 'green' | 'red' | 'blue';
}) {
  const styles = {
    green: 'bg-emerald-950/60 hover:bg-emerald-900/60 border-emerald-800/60 text-emerald-300',
    red:   'bg-red-950/60 hover:bg-red-900/60 border-red-800/60 text-red-300',
    blue:  'bg-sky-950/60 hover:bg-sky-900/60 border-sky-800/60 text-sky-300',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 text-xs border rounded-md px-3 py-2 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [loop, setLoop] = useState<LoopStatus | null>(null);
  const [history, setHistory] = useState<TaskRecord[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [prospectSummaries, setProspectSummaries] = useState<Record<string, ProspectSummary | 'error'>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Create campaign form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', searchQuery: '', maxProspects: '20', minFitScore: '65' });
  const [createLoading, setCreateLoading] = useState(false);

  // Test send form
  const [testSend, setTestSend] = useState({
    profileUrl: '', firstName: '', lastName: '',
    message: '', degree: '1st' as '1st' | '2nd',
    loading: false,
    result: null as { success: boolean; method?: string; error?: string } | null,
  });

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

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/campaign`);
      if (!res.ok) return;
      const data = await res.json();
      const list: Campaign[] = data.campaigns ?? [];
      setCampaigns(list);
      // Load prospect summaries per campaign
      for (const c of list) {
        fetch(`${API}/api/campaign/${c.campaignId}/prospects`)
          .then((r) => r.ok ? r.json() : Promise.reject())
          .then((d) => setProspectSummaries((prev) => ({ ...prev, [c.campaignId]: d.summary })))
          .catch(() => setProspectSummaries((prev) => ({ ...prev, [c.campaignId]: 'error' })));
      }
    } catch { /* service offline */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchCampaigns();
    const si = setInterval(fetchStatus, 5000);
    const sc = setInterval(fetchCampaigns, 15000);
    return () => { clearInterval(si); clearInterval(sc); };
  }, [fetchStatus, fetchCampaigns]);

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

  const campaignAction = async (campaignId: string, act: 'run' | 'pause' | 'resume') => {
    setActionLoading(`${campaignId}-${act}`);
    try {
      const res = await fetch(`${API}/api/campaign/${campaignId}/${act}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchCampaigns();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const createCampaign = async () => {
    if (!createForm.name || !createForm.searchQuery) return;
    setCreateLoading(true);
    try {
      const res = await fetch(`${API}/api/campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          searchQuery: createForm.searchQuery,
          maxProspects: Number(createForm.maxProspects),
          minFitScore: Number(createForm.minFitScore),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const newCampaignId = data.campaign?.campaignId;
      setShowCreate(false);
      setCreateForm({ name: '', searchQuery: '', maxProspects: '20', minFitScore: '65' });
      // Auto-start the campaign immediately after creation
      if (newCampaignId) {
        await fetch(`${API}/api/campaign/${newCampaignId}/run`, { method: 'POST' });
      }
      await fetchCampaigns();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreateLoading(false);
    }
  };

  const sendTestMessage = async () => {
    if (!testSend.profileUrl || !testSend.message) return;
    setTestSend((prev) => ({ ...prev, loading: true, result: null }));
    try {
      const res = await fetch(`${API}/api/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: testSend.profileUrl,
          firstName: testSend.firstName,
          lastName: testSend.lastName,
          message: testSend.message,
          connectionDegree: testSend.degree,
        }),
      });
      const data = await res.json();
      setTestSend((prev) => ({ ...prev, result: { success: res.ok && data.success, method: data.method, error: data.error } }));
    } catch (e: any) {
      setTestSend((prev) => ({ ...prev, result: { success: false, error: e.message } }));
    } finally {
      setTestSend((prev) => ({ ...prev, loading: false }));
    }
  };

  const phase = loop?.phase ?? 'pre-launch';
  const phaseLabel = phaseConfig[phase]?.label ?? phase;
  const phaseColor = phaseConfig[phase]?.color ?? 'text-slate-400';

  const runningCampaigns  = campaigns.filter((c) => c.status === 'running').length;
  const completedCampaigns = campaigns.filter((c) => c.status === 'completed').length;

  return (
    <div className="min-h-screen bg-[#080810] text-slate-300">

      {/* Top nav */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-white font-semibold text-sm tracking-tight">DevClaw</span>
              <span className="text-slate-600 text-sm">/</span>
              <span className="text-slate-400 text-sm">Admin</span>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-500 border border-slate-800 rounded-full px-2.5 py-0.5">
              <StatusDot running={loop?.running ?? false} />
              {loop?.running ? 'CEOClaw online' : 'Loop idle'}
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
          <StatCard label="Total Campaigns" value={campaigns.length} />
          <StatCard label="Running Now"     value={runningCampaigns} />
          <StatCard
            label="Loop Iterations"
            value={loop?.iterationsRun ?? '—'}
            sub={`Phase: ${phaseLabel}`}
          />
          <StatCard label="Completed" value={completedCampaigns} />
        </div>

        {/* MRR progress */}
        {loop && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <MrrBar current={loop.currentMrr} goal={loop.mrrGoal} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Loop controls */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Agent Loop</h2>
                <div className="flex items-center gap-2">
                  <StatusDot running={loop?.running ?? false} />
                  <span className="text-xs text-slate-400">{loop?.running ? 'Running' : 'Idle'}</span>
                </div>
              </div>

              {loop && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/50 rounded-md p-2.5">
                    <p className="text-slate-500">Last task</p>
                    <p className="text-slate-200 font-medium mt-0.5 capitalize truncate">
                      {loop.lastTaskType?.split('.')[1]?.replace(/_/g, ' ') ?? '—'}
                    </p>
                  </div>
                  <div className="bg-slate-800/50 rounded-md p-2.5">
                    <p className="text-slate-500">Last status</p>
                    <p className={`font-medium mt-0.5 ${statusConfig[loop.lastTaskStatus ?? '']?.color ?? 'text-slate-200'}`}>
                      {loop.lastTaskStatus ?? '—'}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {!loop?.running ? (
                  <ActionButton
                    onClick={() => action('/api/loop/start', 'start')}
                    disabled={actionLoading !== null}
                    loading={actionLoading === 'start'}
                    loadingLabel="Starting..."
                    label="Start Loop"
                    variant="green"
                  />
                ) : (
                  <ActionButton
                    onClick={() => action('/api/loop/stop', 'stop')}
                    disabled={actionLoading !== null}
                    loading={actionLoading === 'stop'}
                    loadingLabel="Stopping..."
                    label="Stop Loop"
                    variant="red"
                  />
                )}
                <ActionButton
                  onClick={() => action('/api/loop/tick', 'tick')}
                  disabled={actionLoading !== null}
                  loading={actionLoading === 'tick'}
                  loadingLabel="Running..."
                  label="Run Tick"
                  variant="blue"
                />
              </div>
            </section>

            {/* Quick Test Send */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Quick Test Send</h2>
                <p className="text-xs text-slate-500 mt-0.5">Send directly to any LinkedIn profile — bypasses discovery</p>
              </div>
              <div className="space-y-2">
                <input
                  type="url"
                  placeholder="https://www.linkedin.com/in/..."
                  value={testSend.profileUrl}
                  onChange={(e) => setTestSend((p) => ({ ...p, profileUrl: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="First name"
                    value={testSend.firstName}
                    onChange={(e) => setTestSend((p) => ({ ...p, firstName: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    value={testSend.lastName}
                    onChange={(e) => setTestSend((p) => ({ ...p, lastName: e.target.value }))}
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
                </div>
                <select
                  value={testSend.degree}
                  onChange={(e) => setTestSend((p) => ({ ...p, degree: e.target.value as '1st' | '2nd' }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
                >
                  <option value="1st">1st — Direct message</option>
                  <option value="2nd">2nd — Connection request</option>
                </select>
                <div className="relative">
                  <textarea
                    placeholder="Message…"
                    rows={3}
                    maxLength={300}
                    value={testSend.message}
                    onChange={(e) => setTestSend((p) => ({ ...p, message: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500 resize-none"
                  />
                  <span className="absolute bottom-2 right-2 text-xs text-slate-600">{testSend.message.length}/300</span>
                </div>
                <button
                  onClick={sendTestMessage}
                  disabled={testSend.loading || !testSend.profileUrl || !testSend.message}
                  className="w-full text-xs border rounded-md px-3 py-2 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-sky-950/60 hover:bg-sky-900/60 border-sky-800/60 text-sky-300"
                >
                  {testSend.loading ? 'Sending…' : 'Send Message'}
                </button>
                {testSend.result && (
                  <div className={`text-xs rounded-md px-3 py-2 border ${testSend.result.success ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-red-950/40 border-red-800/50 text-red-300'}`}>
                    {testSend.result.success
                      ? `✓ Sent via ${testSend.result.method ?? 'unknown'}`
                      : `✗ ${testSend.result.error}`}
                  </div>
                )}
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

            {/* LinkedIn Campaigns */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-200">LinkedIn Campaigns</h2>
                <button
                  onClick={() => setShowCreate((v) => !v)}
                  className="text-xs border rounded-md px-3 py-1.5 font-medium transition-colors bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                >
                  {showCreate ? 'Cancel' : '+ New Campaign'}
                </button>
              </div>

              {/* Create form */}
              {showCreate && (
                <div className="mb-4 space-y-2 border border-slate-700 rounded-lg p-3 bg-slate-800/40">
                  <input
                    type="text"
                    placeholder="Campaign name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
                  <input
                    type="text"
                    placeholder="LinkedIn search query (e.g. CTO startup software)"
                    value={createForm.searchQuery}
                    onChange={(e) => setCreateForm((p) => ({ ...p, searchQuery: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Max prospects</label>
                      <input
                        type="number"
                        value={createForm.maxProspects}
                        onChange={(e) => setCreateForm((p) => ({ ...p, maxProspects: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Min fit score</label>
                      <input
                        type="number"
                        value={createForm.minFitScore}
                        onChange={(e) => setCreateForm((p) => ({ ...p, minFitScore: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={createCampaign}
                    disabled={createLoading || !createForm.name || !createForm.searchQuery}
                    className="w-full text-xs border rounded-md px-3 py-2 font-medium transition-colors disabled:opacity-40 bg-emerald-950/60 hover:bg-emerald-900/60 border-emerald-800/60 text-emerald-300"
                  >
                    {createLoading ? 'Creating…' : 'Create & Discover Prospects'}
                  </button>
                </div>
              )}

              {/* Campaign list */}
              {campaigns.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-8">No campaigns yet. Create one above.</p>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto -mx-1 px-1">
                  {campaigns.map((c) => {
                    const summary = prospectSummaries[c.campaignId];
                    const isRunningAct = actionLoading?.startsWith(c.campaignId);
                    return (
                      <div key={c.campaignId} className="border border-slate-800 rounded-lg p-3 bg-slate-800/20 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 truncate">{c.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">"{c.searchQuery}"</p>
                          </div>
                          <Pill className={campaignStatusBadge[c.status] ?? campaignStatusBadge.draft}>
                            {c.status}
                          </Pill>
                        </div>

                        {/* Prospect counts */}
                        {summary && summary !== 'error' && (
                          <div className="flex gap-3 text-xs text-slate-500">
                            {summary.total > 0 && <span>{summary.total} total</span>}
                            {(summary.messageReady ?? 0) > 0 && <span className="text-amber-400">{summary.messageReady} ready</span>}
                            {(summary.connectionSent ?? 0) > 0 && <span className="text-sky-400">{summary.connectionSent} sent</span>}
                            {(summary.messaged ?? 0) > 0 && <span className="text-emerald-400">{summary.messaged} messaged</span>}
                            {(summary.replied ?? 0) > 0 && <span className="text-violet-400">{summary.replied} replied</span>}
                            {summary.total === 0 && <span>No prospects yet</span>}
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          {c.status === 'draft' && (
                            <button
                              onClick={() => campaignAction(c.campaignId, 'run')}
                              disabled={isRunningAct}
                              className="text-xs border rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-40 bg-emerald-950/40 hover:bg-emerald-900/40 border-emerald-800/50 text-emerald-300"
                            >
                              {isRunningAct ? '…' : 'Run'}
                            </button>
                          )}
                          {c.status === 'running' && (
                            <button
                              onClick={() => campaignAction(c.campaignId, 'pause')}
                              disabled={isRunningAct}
                              className="text-xs border rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-40 bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                            >
                              {isRunningAct ? '…' : 'Pause'}
                            </button>
                          )}
                          {(c.status === 'paused' || c.status === 'completed') && (
                            <button
                              onClick={() => campaignAction(c.campaignId, 'resume')}
                              disabled={isRunningAct}
                              className="text-xs border rounded px-2.5 py-1 font-medium transition-colors disabled:opacity-40 bg-sky-950/40 hover:bg-sky-900/40 border-sky-800/50 text-sky-300"
                            >
                              {isRunningAct ? '…' : 'Resume Send'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Task history */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-200">Agent Task History</h2>
                <span className="text-xs text-slate-500">{history.length} recent tasks</span>
              </div>
              {history.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-slate-600">No tasks yet. Start the loop or run a tick.</p>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                  {history.map((task) => (
                    <TaskRow key={task.taskId} task={task} />
                  ))}
                </div>
              )}
            </section>

            {/* PR workflow */}
            <section className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">DevClaw — PR Workflow</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { step: '1', label: 'Plan',        model: 'glm-4-long',    desc: '128k ctx, full repo read', color: 'border-sky-800/40 bg-sky-950/20',        text: 'text-sky-400'     },
                  { step: '2', label: 'Generate',    model: 'glm-4.7-flash', desc: 'Writes code patches',      color: 'border-emerald-800/40 bg-emerald-950/20', text: 'text-emerald-400' },
                  { step: '3', label: 'Review',      model: 'glm-4.7-flash', desc: 'Quality & correctness',    color: 'border-emerald-800/40 bg-emerald-950/20', text: 'text-emerald-400' },
                  { step: '4', label: 'Orchestrate', model: 'glm-z1-flash',  desc: 'Deep CoT over state',      color: 'border-violet-800/40 bg-violet-950/20',   text: 'text-violet-400'  },
                ].map((s) => (
                  <div key={s.step} className={`border rounded-lg p-3 ${s.color}`}>
                    <p className="text-xs text-slate-500 font-medium">Step {s.step}</p>
                    <p className="text-sm font-semibold text-slate-200 mt-0.5">{s.label}</p>
                    <p className={`text-xs font-mono font-semibold mt-1 ${s.text}`}>{s.model}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-600 pb-4">
          <a href={`${API}/health`} target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
            CEOClaw API · {API}
          </a>
          <a href="https://dev-claw-landing-page-one.vercel.app/" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
            dev-claw-landing-page-one.vercel.app ↗
          </a>
        </div>
      </main>
    </div>
  );
}
