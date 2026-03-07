interface Props {
  onBack: () => void;
  onGetStarted: () => void;
}

const PIPELINE_STEPS = [
  {
    step: '01',
    phase: 'Intake',
    title: 'You describe the task',
    body: 'Send a message on Telegram or WhatsApp — in plain English. "Fix the login bug", "add dark mode", "refactor the auth module". No tickets, no PRs, no context switching.',
    model: null,
    accent: 'border-white/10',
    dot: 'bg-white/30',
  },
  {
    step: '02',
    phase: 'Planning',
    title: 'GLM-4-long reads your entire codebase',
    body: 'With a 128k-token context window, the Planner agent reads the full repository tree, understands your architecture, and produces a precise plan: which files change, what approach to take, and risk flags to watch.',
    model: 'glm-4-long · 128k context',
    accent: 'border-sky-800/40',
    dot: 'bg-sky-400',
  },
  {
    step: '03',
    phase: 'Approval',
    title: 'You approve — in one tap',
    body: 'The architecture plan is sent back to your Telegram or WhatsApp chat. Review it, approve or reject. Only after approval does any code get written. You stay in control.',
    model: null,
    accent: 'border-white/10',
    dot: 'bg-white/30',
  },
  {
    step: '04',
    phase: 'Generation',
    title: 'GLM-4.7-flash writes the code',
    body: 'The Generator agent receives the approved plan and writes production-ready code changes across all affected files — using its native chain-of-thought to reason through each patch before committing it.',
    model: 'glm-4.7-flash · direct Z.AI API',
    accent: 'border-emerald-800/40',
    dot: 'bg-emerald-400',
  },
  {
    step: '05',
    phase: 'Review loop',
    title: 'GLM-4.7-flash reviews — and retries up to 3×',
    body: 'A second Reviewer agent independently checks the generated code for correctness, edge cases, and style. If it raises issues, the Generator rewrites — up to 3 iterations automatically. Only APPROVED code moves forward.',
    model: 'glm-4.7-flash · agentic retry loop',
    accent: 'border-violet-800/40',
    dot: 'bg-violet-400',
  },
  {
    step: '06',
    phase: 'Delivery',
    title: 'A real GitHub PR lands in your repo',
    body: 'DevClaw pushes the approved code to a feature branch, opens a pull request with a full description and diff, and sends you the link. You review, merge, and ship.',
    model: null,
    accent: 'border-red-800/40',
    dot: 'bg-red-brand',
  },
];

const MODEL_TABLE = [
  { role: 'Architecture Planner', model: 'glm-4-long', path: 'OpenRouter', why: '128k context — reads entire repos', color: 'text-sky-400' },
  { role: 'Workflow Orchestrator', model: 'glm-4.7', path: 'OpenRouter', why: 'Complex multi-step reasoning', color: 'text-violet-400' },
  { role: 'Code Generator', model: 'glm-4.7-flash', path: 'Direct Z.AI API', why: 'Fast, high-quality code with native CoT', color: 'text-emerald-400' },
  { role: 'Code Reviewer', model: 'glm-4.7-flash', path: 'Direct Z.AI API', why: 'Independent quality gate per iteration', color: 'text-emerald-400' },
  { role: 'Frontend Generator', model: 'glm-4.7-flash', path: 'Direct Z.AI API', why: 'Specialised UI/CSS/React generation', color: 'text-amber-400' },
  { role: 'Backend Generator', model: 'glm-4.7-flash', path: 'Direct Z.AI API', why: 'Specialised API/DB/service generation', color: 'text-amber-400' },
];

const STATS = [
  { value: '6', label: 'GLM model roles' },
  { value: '3×', label: 'Max review iterations' },
  { value: '128k', label: 'Context window' },
  { value: '2', label: 'Messaging channels' },
];

export default function AboutPage({ onBack, onGetStarted }: Props) {
  return (
    <div className="bg-[#050505] min-h-screen text-white">
      <div className="grain-overlay" aria-hidden="true" />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#050505]/80 backdrop-blur-md">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/40 hover:text-white/80 text-xs font-mono tracking-widest transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          BACK
        </button>

        <div className="flex items-center gap-1.5">
          <span className="font-thin text-white/60 text-sm tracking-[0.2em] uppercase">DEV</span>
          <span className="w-px h-3 bg-red-brand/50" />
          <span className="text-sm tracking-[0.2em] uppercase" style={{
            background: 'linear-gradient(135deg, #ff6070, #E8192C)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>CLAW</span>
        </div>

        <button
          onClick={onGetStarted}
          className="text-xs font-mono tracking-widest text-red-500 hover:text-red-brand border border-red-900/60 hover:border-red-brand/60 rounded px-4 py-1.5 transition-all"
        >
          GET STARTED
        </button>
      </nav>

      <div className="max-w-4xl mx-auto px-6 pt-28 pb-24 space-y-32">

        {/* Hero */}
        <section className="text-center space-y-6">
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">AI Engineering Agent</span>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-red-brand/40" />
          </div>
          <h1 className="text-4xl md:text-6xl font-thin text-white tracking-widest uppercase" style={{ textShadow: '0 0 60px rgba(232,25,44,0.2)' }}>
            From message<br />to merged PR
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
            DevClaw is a multi-agent AI system that turns a plain-language description into a real GitHub pull request — no IDE, no manual steps, no waiting.
          </p>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            {STATS.map((s) => (
              <div key={s.label} className="border border-white/[0.08] rounded-xl p-4 bg-white/[0.02]">
                <p className="text-3xl font-thin text-white" style={{ textShadow: '0 0 20px rgba(232,25,44,0.3)' }}>{s.value}</p>
                <p className="text-xs text-white/40 font-mono tracking-wider mt-1 uppercase">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pipeline */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">The Pipeline</span>
          </div>
          <h2 className="text-2xl font-thin text-white tracking-widest uppercase">How it works</h2>
          <p className="text-white/40 text-sm max-w-lg">Six stages. Three GLM models. One merged pull request.</p>

          <div className="relative mt-10">
            {/* Vertical connector line */}
            <div className="absolute left-[19px] top-6 bottom-6 w-px bg-gradient-to-b from-white/5 via-red-brand/20 to-white/5" />

            <div className="space-y-4">
              {PIPELINE_STEPS.map((s) => (
                <div key={s.step} className={`relative flex gap-6 p-5 rounded-xl border ${s.accent} bg-white/[0.02] hover:bg-white/[0.035] transition-colors`}>
                  {/* Step dot */}
                  <div className="flex-shrink-0 relative z-10">
                    <div className={`w-10 h-10 rounded-full border ${s.accent} bg-[#050505] flex items-center justify-center`}>
                      <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <span className="text-[10px] font-mono text-white/25 tracking-widest uppercase">{s.phase}</span>
                        <h3 className="text-sm font-semibold text-white/90 mt-0.5">{s.title}</h3>
                      </div>
                      {s.model && (
                        <span className="flex-shrink-0 text-[10px] font-mono px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.04] text-white/40 tracking-wider">
                          {s.model}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white/45 leading-relaxed mt-2">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* GLM Model Table */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">Z.AI GLM Models</span>
          </div>
          <h2 className="text-2xl font-thin text-white tracking-widest uppercase">Six roles. One model family.</h2>
          <p className="text-white/40 text-sm max-w-lg">Every agent in DevClaw runs on Z.AI's GLM model ecosystem. Each model is matched to the cognitive complexity of its role.</p>

          <div className="border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 text-[10px] font-mono text-white/25 tracking-widest uppercase px-5 py-3 border-b border-white/[0.06]">
              <span className="col-span-4">Role</span>
              <span className="col-span-3">Model</span>
              <span className="col-span-2">Path</span>
              <span className="col-span-3">Why</span>
            </div>
            {MODEL_TABLE.map((row, i) => (
              <div
                key={row.role}
                className={`grid grid-cols-12 px-5 py-4 text-sm items-start ${i !== MODEL_TABLE.length - 1 ? 'border-b border-white/[0.04]' : ''} hover:bg-white/[0.02] transition-colors`}
              >
                <span className="col-span-4 text-white/60 text-xs pr-2">{row.role}</span>
                <span className={`col-span-3 font-mono text-xs font-semibold ${row.color}`}>{row.model}</span>
                <span className="col-span-2 text-white/30 text-xs">{row.path}</span>
                <span className="col-span-3 text-white/35 text-xs leading-relaxed">{row.why}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-white/20 font-mono">
            Fallback: if OpenRouter is unavailable, all roles fall back to glm-4.7-flash via direct Z.AI API. The system never leaves the GLM family.
          </p>
        </section>

        {/* Key capabilities */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">Capabilities</span>
          </div>
          <h2 className="text-2xl font-thin text-white tracking-widest uppercase">Built for production</h2>

          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                title: 'Agentic retry loop',
                body: 'If the Reviewer rejects generated code, the Generator rewrites automatically — up to 3 iterations per sub-task. No human intervention required.',
                icon: '↻',
                color: 'border-violet-800/40 bg-violet-950/10',
              },
              {
                title: 'Full repo context',
                body: 'GLM-4-long\'s 128k context window ingests your entire repository tree before generating a single line of code. No hallucinated file paths or wrong imports.',
                icon: '⌁',
                color: 'border-sky-800/40 bg-sky-950/10',
              },
              {
                title: 'Telegram & WhatsApp',
                body: 'Two messaging channels, one workflow. Describe tasks, approve plans, receive PR links — all without leaving the chat you\'re already in.',
                icon: '⤳',
                color: 'border-emerald-800/40 bg-emerald-950/10',
              },
              {
                title: 'Real GitHub integration',
                body: 'Actual pull requests on your actual repositories. Proper diffs, branch names, descriptions, and CI triggers — not simulated, not mocked.',
                icon: '⌥',
                color: 'border-red-800/40 bg-red-950/10',
              },
              {
                title: 'Human approval gate',
                body: 'You review and approve the architecture plan before any code is generated. Keeps AI-assisted development safe for production repos.',
                icon: '✓',
                color: 'border-amber-800/40 bg-amber-950/10',
              },
              {
                title: 'Domain-split agents',
                body: 'Frontend and backend code are handled by separate generator/reviewer pairs — each prompted with domain-specific context for higher quality output.',
                icon: '⊕',
                color: 'border-white/10 bg-white/[0.02]',
              },
            ].map((cap) => (
              <div key={cap.title} className={`border rounded-xl p-5 ${cap.color}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-lg text-white/40 font-mono">{cap.icon}</span>
                  <h3 className="text-xs font-semibold text-white/80 tracking-widest uppercase">{cap.title}</h3>
                </div>
                <p className="text-sm text-white/45 leading-relaxed">{cap.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture diagram (text-based) */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">Architecture</span>
          </div>
          <h2 className="text-2xl font-thin text-white tracking-widest uppercase">System design</h2>

          <div className="border border-white/[0.08] rounded-xl p-6 bg-white/[0.01] font-mono text-xs leading-loose">
            <div className="text-white/20 space-y-1">
              <div className="text-white/50">Telegram / WhatsApp</div>
              <div className="pl-4 text-white/30">↓  intake message</div>
              <div className="pl-4 text-sky-400/70">Orchestrator  <span className="text-white/20">(port 3010)</span></div>
              <div className="pl-8 text-white/30">↓  create GitHub issue</div>
              <div className="pl-8 text-sky-400/70">Planner  <span className="text-white/20">glm-4-long · 128k ctx</span></div>
              <div className="pl-12 text-white/30">↓  architecture plan</div>
              <div className="pl-12 text-white/50">→  send to user for approval</div>
              <div className="pl-12 text-white/30">↓  approved</div>
              <div className="pl-8 text-emerald-400/70">Agent Runner  <span className="text-white/20">(port 3030)</span></div>
              <div className="pl-12 text-white/30">for each sub-task:</div>
              <div className="pl-16 text-emerald-400/70">Generator  <span className="text-white/20">glm-4.7-flash</span></div>
              <div className="pl-20 text-white/30">↓  code patch</div>
              <div className="pl-16 text-violet-400/70">Reviewer   <span className="text-white/20">glm-4.7-flash</span></div>
              <div className="pl-20 text-white/30">→  APPROVED  →  next sub-task</div>
              <div className="pl-20 text-white/30">→  REWRITE   →  back to Generator (max 3×)</div>
              <div className="pl-8 text-white/30">↓  all sub-tasks approved</div>
              <div className="pl-8 text-red-400/70">GitHub Client  <span className="text-white/20">→  branch push → PR opened</span></div>
              <div className="pl-8 text-white/30">↓  PR link</div>
              <div className="pl-4 text-white/50">Telegram / WhatsApp  <span className="text-white/30">"Your PR is ready"</span></div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-6 pb-8">
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">Try it now</span>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-red-brand/40" />
          </div>
          <h2 className="text-3xl font-thin text-white tracking-widest uppercase">Ready to ship faster?</h2>
          <p className="text-white/40 text-sm max-w-sm mx-auto">Connect your GitHub repo and send your first task via Telegram or WhatsApp.</p>
          <button
            onClick={onGetStarted}
            className="group inline-flex items-center gap-3 px-12 py-4 rounded-md bg-transparent border border-red-900/80 text-red-500 font-mono text-sm tracking-widest hover:border-red-brand hover:text-red-brand hover:bg-red-950/20 active:scale-95 transition-all duration-300"
            style={{ boxShadow: '0 0 40px rgba(232,25,44,0.06)' }}
          >
            GET STARTED
            <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
          </button>
          <p className="text-[10px] text-white/15 font-mono tracking-[0.3em]">POWERED BY Z.AI GLM · DEVCLAW</p>
        </section>
      </div>
    </div>
  );
}
