import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:3050';
const ADMIN_PASSWORD = 'devclaw2024';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'paused' | 'failed';
  searchQuery: string;
  maxProspects: number;
  minFitScore: number;
  createdAt: string;
}

interface ProspectSummary {
  total: number;
  discovered: number;
  qualified: number;
  disqualified: number;
  messageReady: number;
  connectionSent: number;
  messaged: number;
  replied: number;
}

interface LoopStatus {
  running: boolean;
  lastRunAt?: string;
  iterationCount?: number;
}

interface Props {
  onBack: () => void;
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Campaign['status'] }) {
  const styles: Record<Campaign['status'], string> = {
    pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    running:   'bg-green-500/10  text-green-400  border-green-500/20',
    completed: 'bg-blue-500/10   text-blue-400   border-blue-500/20',
    paused:    'bg-gray-500/10   text-gray-400   border-gray-500/20',
    failed:    'bg-red-500/10    text-red-400    border-red-500/20',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color = 'red' }: { label: string; value: number | string; icon: React.ReactNode; color?: string }) {
  const colorMap: Record<string, string> = {
    red:    'from-red-500/20   border-red-500/20',
    green:  'from-green-500/20 border-green-500/20',
    blue:   'from-blue-500/20  border-blue-500/20',
    purple: 'from-purple-500/20 border-purple-500/20',
  };
  return (
    <div className={`relative rounded-2xl border bg-gradient-to-br ${colorMap[color]} to-transparent p-5 overflow-hidden`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-1">{label}</p>
          <p className="text-3xl font-black text-white">{value}</p>
        </div>
        <div className="p-2 rounded-xl bg-white/5">{icon}</div>
      </div>
    </div>
  );
}

// ─── Campaign row ──────────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onRun,
  onPause,
  onResume,
}: {
  campaign: Campaign;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const [summary, setSummary] = useState<ProspectSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadProspects = useCallback(async () => {
    if (summary) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/campaign/${campaign.id}/prospects`);
      const d = await r.json();
      if (d.success) setSummary(d.summary);
    } catch { /* server may be offline */ }
    setLoading(false);
  }, [campaign.id, summary]);

  const toggle = () => {
    if (!expanded) loadProspects();
    setExpanded(v => !v);
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        <button
          onClick={toggle}
          className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center flex-shrink-0"
        >
          <svg className={`w-3.5 h-3.5 text-white/50 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{campaign.name}</p>
          <p className="text-white/30 text-xs truncate mt-0.5">"{campaign.searchQuery}"</p>
        </div>

        <StatusBadge status={campaign.status} />

        <div className="flex items-center gap-2">
          {campaign.status === 'running' && (
            <button onClick={() => onPause(campaign.id)} className="px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 text-xs font-semibold hover:bg-yellow-500/20 transition-colors border border-yellow-500/20">
              Pause
            </button>
          )}
          {(campaign.status === 'paused' || campaign.status === 'completed') && (
            <button onClick={() => onResume(campaign.id)} className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-semibold hover:bg-blue-500/20 transition-colors border border-blue-500/20">
              Resume Send
            </button>
          )}
          {(campaign.status === 'pending' || campaign.status === 'failed') && (
            <button onClick={() => onRun(campaign.id)} className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold hover:bg-green-500/20 transition-colors border border-green-500/20">
              Run
            </button>
          )}
        </div>
      </div>

      {/* Expanded prospect stats */}
      {expanded && (
        <div className="border-t border-white/5 px-5 py-4">
          {loading ? (
            <p className="text-white/30 text-xs">Loading prospects...</p>
          ) : summary ? (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Discovered', value: summary.total, color: 'text-white/60' },
                { label: 'Qualified', value: summary.qualified, color: 'text-green-400' },
                { label: 'Connections', value: summary.connectionSent, color: 'text-blue-400' },
                { label: 'Messaged', value: summary.messaged, color: 'text-purple-400' },
                { label: 'Replied', value: summary.replied, color: 'text-red-400' },
                { label: 'Disqualified', value: summary.disqualified, color: 'text-white/30' },
                { label: 'Msg Ready', value: summary.messageReady, color: 'text-yellow-400' },
                { label: 'Max Prospects', value: campaign.maxProspects, color: 'text-white/40' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/[0.03] rounded-xl p-3">
                  <p className={`text-xl font-black ${color}`}>{value}</p>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/30 text-xs">Could not load prospect data — is the CEOClaw service running?</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create campaign modal ─────────────────────────────────────────────────────

function CreateCampaignForm({ onCreate }: { onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('CTO startup hiring software engineers');
  const [maxProspects, setMaxProspects] = useState(20);
  const [minFit, setMinFit] = useState(65);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim() || !query.trim()) { setError('Name and search query are required.'); return; }
    setSubmitting(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), searchQuery: query.trim(), maxProspects, minFitScore: minFit }),
      });
      const d = await r.json();
      if (d.success) { setOpen(false); setName(''); onCreate(); }
      else setError(d.error || 'Failed to create campaign.');
    } catch { setError('CEOClaw service unreachable. Is it running on port 3050?'); }
    setSubmitting(false);
  };

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-brand text-white text-sm font-semibold hover:bg-red-700 transition-colors"
      style={{ boxShadow: '0 0 20px rgba(232,25,44,0.3)' }}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      New Campaign
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-white font-bold text-lg">New Campaign</h3>
          <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/60 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-white/50 text-xs font-medium uppercase tracking-wider block mb-1.5">Campaign Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="DevClaw CTO Outreach - April"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-brand transition-colors"
            />
          </div>
          <div>
            <label className="text-white/50 text-xs font-medium uppercase tracking-wider block mb-1.5">LinkedIn Search Query</label>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="CTO startup hiring engineers"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-brand transition-colors"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-white/50 text-xs font-medium uppercase tracking-wider block mb-1.5">Max Prospects</label>
              <input
                type="number" min={1} max={100}
                value={maxProspects}
                onChange={e => setMaxProspects(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-brand transition-colors"
              />
            </div>
            <div>
              <label className="text-white/50 text-xs font-medium uppercase tracking-wider block mb-1.5">Min Fit Score</label>
              <input
                type="number" min={0} max={100}
                value={minFit}
                onChange={e => setMinFit(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-red-brand transition-colors"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="mt-2 py-3 rounded-xl bg-red-brand text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            style={{ boxShadow: '0 0 20px rgba(232,25,44,0.3)' }}
          >
            {submitting ? 'Creating...' : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────────

export default function AdminPage({ onBack }: Props) {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const [camR, loopR] = await Promise.all([
        fetch(`${API_BASE}/api/campaign`).catch(() => null),
        fetch(`${API_BASE}/api/loop/status`).catch(() => null),
      ]);
      if (camR?.ok) {
        const d = await camR.json();
        if (d.success) setCampaigns(d.campaigns || []);
        setServiceOnline(true);
      } else {
        setServiceOnline(false);
      }
      if (loopR?.ok) {
        const d = await loopR.json();
        if (d.success) setLoopStatus(d.loop);
      }
    } catch { setServiceOnline(false); }
    setLoadingCampaigns(false);
  }, []);

  useEffect(() => {
    if (authed) fetchAll();
  }, [authed, fetchAll]);

  const login = () => {
    if (pwInput === ADMIN_PASSWORD) { setAuthed(true); setPwError(false); }
    else { setPwError(true); setPwInput(''); }
  };

  const handleRun = async (id: string) => {
    await fetch(`${API_BASE}/api/campaign/${id}/run`, { method: 'POST' });
    setTimeout(fetchAll, 500);
  };

  const handlePause = async (id: string) => {
    await fetch(`${API_BASE}/api/campaign/${id}/pause`, { method: 'POST' });
    setTimeout(fetchAll, 500);
  };

  const handleResume = async (id: string) => {
    await fetch(`${API_BASE}/api/campaign/${id}/resume`, { method: 'POST' });
    setTimeout(fetchAll, 500);
  };

  const toggleLoop = async () => {
    const endpoint = loopStatus?.running ? '/api/loop/stop' : '/api/loop/start';
    await fetch(`${API_BASE}${endpoint}`, { method: 'POST' }).catch(() => {});
    setTimeout(fetchAll, 600);
  };

  // Aggregate totals
  const totalCampaigns = campaigns.length;
  const running = campaigns.filter(c => c.status === 'running').length;

  // ── Password gate ──────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center px-6">
        <div className="grain-overlay" aria-hidden="true" />

        {/* Back */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-2 text-white/30 hover:text-white/60 text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Back
        </button>

        <div className="relative z-10 w-full max-w-sm">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div
              className="w-16 h-16 rounded-2xl bg-red-brand flex items-center justify-center"
              style={{ boxShadow: '0 0 40px rgba(232,25,44,0.5)' }}
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-white font-black text-2xl tracking-tight">
              Dev<span className="text-red-brand">Claw</span> Admin
            </h1>
            <p className="text-white/30 text-sm">CEOClaw campaign control</p>
          </div>

          {/* Form */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <label className="text-white/40 text-xs uppercase tracking-wider font-medium block mb-2">Password</label>
            <input
              type="password"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              placeholder="Enter admin password"
              autoFocus
              className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none transition-colors ${
                pwError ? 'border-red-brand' : 'border-white/10 focus:border-red-brand'
              }`}
            />
            {pwError && <p className="text-red-400 text-xs mt-2">Incorrect password.</p>}
            <button
              onClick={login}
              className="w-full mt-4 py-3 rounded-xl bg-red-brand text-white font-bold text-sm hover:bg-red-700 transition-colors"
              style={{ boxShadow: '0 0 20px rgba(232,25,44,0.3)' }}
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="grain-overlay" aria-hidden="true" />

      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#050505]/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-white/30 hover:text-white/60 transition-colors mr-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
            </button>
            <div
              className="w-7 h-7 rounded-lg bg-red-brand flex items-center justify-center"
              style={{ boxShadow: '0 0 15px rgba(232,25,44,0.4)' }}
            >
              <span className="text-white font-bold text-xs font-mono">DC</span>
            </div>
            <span className="font-bold text-sm">
              Dev<span className="text-red-brand">Claw</span>
              <span className="text-white/30 font-normal"> / Admin</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Service status */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${serviceOnline === null ? 'bg-yellow-400' : serviceOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-white/40">
                {serviceOnline === null ? 'Checking...' : serviceOnline ? 'CEOClaw online' : 'Service offline'}
              </span>
            </div>

            {/* Loop toggle */}
            {serviceOnline && (
              <button
                onClick={toggleLoop}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  loopStatus?.running
                    ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20'
                    : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${loopStatus?.running ? 'bg-green-400 animate-ping' : 'bg-white/20'}`} />
                {loopStatus?.running ? 'Loop running' : 'Start loop'}
              </button>
            )}

            <button
              onClick={fetchAll}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/40 hover:text-white/70"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Campaigns"
            value={totalCampaigns}
            color="red"
            icon={<svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
          />
          <StatCard
            label="Running Now"
            value={running}
            color="green"
            icon={<svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <StatCard
            label="Loop Iterations"
            value={loopStatus?.iterationCount ?? '—'}
            color="blue"
            icon={<svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
          />
          <StatCard
            label="Completed"
            value={campaigns.filter(c => c.status === 'completed').length}
            color="purple"
            icon={<svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
        </div>

        {/* Campaigns section */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-base">LinkedIn Campaigns</h2>
          <CreateCampaignForm onCreate={fetchAll} />
        </div>

        {!serviceOnline && serviceOnline !== null && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 mb-4">
            <p className="text-red-400 text-sm font-medium">CEOClaw service is offline</p>
            <p className="text-white/30 text-xs mt-1">
              Start it with <code className="font-mono bg-white/5 px-1 rounded">cd services/ceoclaw-founder && npm run dev</code>
            </p>
          </div>
        )}

        {loadingCampaigns ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-red-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
            <svg className="w-10 h-10 text-white/10 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-white/30 text-sm">No campaigns yet. Create your first one above.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {campaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onRun={handleRun}
                onPause={handlePause}
                onResume={handleResume}
              />
            ))}
          </div>
        )}

        {/* Footer info */}
        <div className="mt-10 pt-6 border-t border-white/5 flex flex-wrap gap-6 text-xs text-white/20">
          <span>CEOClaw API · {API_BASE}</span>
          {loopStatus?.lastRunAt && (
            <span>Last loop run: {new Date(loopStatus.lastRunAt).toLocaleString()}</span>
          )}
          <a
            href="https://dev-claw-landing-page-one.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-white/20 hover:text-white/40 transition-colors"
          >
            dev-claw-landing-page-one.vercel.app ↗
          </a>
        </div>
      </main>
    </div>
  );
}
