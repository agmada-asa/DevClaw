import CrabSVG from './CrabSVG';

interface Props {
  onEnter: () => void;
  onAdmin: () => void;
}

// Static star field — generated once, stable positions
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: ((i * 137.508) % 100),
  y: ((i * 97.346 + 13) % 100),
  size: i % 5 === 0 ? 2 : i % 3 === 0 ? 1.5 : 1,
  delay: (i * 0.13) % 4,
  duration: 2.5 + (i % 3) * 0.8,
}));

const PROBLEMS = [
  {
    number: '01',
    title: 'Wasted developer time',
    body: 'Engineers spend hours each week on repetitive tasks — writing boilerplate, opening PRs, updating changelogs — instead of solving real problems.',
  },
  {
    number: '02',
    title: 'Workflow friction',
    body: 'Constant context-switching between editors, GitHub, Slack, and CI tools breaks deep focus and slows delivery to a crawl.',
  },
  {
    number: '03',
    title: 'Death by latency',
    body: 'Manual review cycles, stale branches, and integration bottlenecks mean weeks pass between an idea and a merged pull request.',
  },
];

const SOLUTIONS = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Natural language to code',
    body: 'Describe the change in plain English via Telegram or WhatsApp. DevClaw understands intent and generates production-ready code instantly.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Full workflow automation',
    body: 'From branch creation to pull request — DevClaw handles every step autonomously. No IDE open, no manual commits, no review bottlenecks.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    title: 'Instant GitHub integration',
    body: 'DevClaw connects directly to your repositories. Real pull requests with proper diffs, descriptions, and CI triggers — merged in minutes, not days.',
  },
];

export default function LandingPage({ onEnter, onAdmin }: Props) {
  return (
    <div className="bg-[#050505] select-none">

      {/* ── Admin button — fixed top left, always visible ── */}
      <button
        onClick={onAdmin}
        className="fixed top-6 left-6 z-50 text-[10px] text-white/20 hover:text-white/60 font-mono tracking-[0.2em] transition-colors duration-200"
      >
        ADMIN
      </button>

      {/* ── Film grain overlay — fixed, covers all sections ── */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* ════════════════════════════════════════════════════
          HERO SECTION
      ════════════════════════════════════════════════════ */}
      <section className="relative h-screen overflow-hidden flex items-center justify-center">

        {/* Star field */}
        <div className="absolute inset-0 pointer-events-none z-0" aria-hidden="true">
          {STARS.map(s => (
            <div
              key={s.id}
              className="absolute rounded-full bg-white animate-twinkle"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.size,
                height: s.size,
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.duration}s`,
                opacity: 0,
              }}
            />
          ))}
        </div>

        {/* Deep vignette */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'radial-gradient(circle at center, transparent 10%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.95) 100%)',
          }}
        />

        {/* Earth background */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <div className="relative w-[78vw] max-w-[1100px] aspect-square animate-float" style={{ opacity: 0.28 }}>
            <img
              src="https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2000&auto=format&fit=crop"
              alt=""
              className="w-full h-full object-cover rounded-full"
              style={{
                filter: 'blur(7px) saturate(0.2) hue-rotate(300deg) brightness(0.35) contrast(1.6) sepia(0.5)',
              }}
            />
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: 'radial-gradient(ellipse at 40% 45%, rgba(232,25,44,0.3) 0%, rgba(100,10,18,0.15) 50%, transparent 75%)', mixBlendMode: 'overlay' }}
            />
            <div
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: 'inset 0 0 80px 40px #050505' }}
            />
          </div>
        </div>

        {/* Scan line */}
        <div className="absolute inset-0 pointer-events-none z-5 overflow-hidden" aria-hidden="true">
          <div className="scan-line" />
        </div>

        {/* Pulsing floor glow */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] pointer-events-none animate-glow-pulse"
          style={{
            background: 'radial-gradient(ellipse at center bottom, #E8192C 0%, transparent 65%)',
            filter: 'blur(60px)',
            opacity: 0.1,
          }}
        />

        {/* Crab */}
        <div
          className="absolute bottom-[-4%] left-1/2 -translate-x-1/2 w-[min(110vw,900px)] pointer-events-none animate-float"
          style={{ opacity: 0.22 }}
        >
          <CrabSVG
            className="w-full h-auto"
            style={{ filter: 'drop-shadow(0 0 40px rgba(232,25,44,0.2))' }}
          />
        </div>

        {/* Secondary ambient glow */}
        <div
          className="absolute top-[-10%] left-[-5%] w-[500px] h-[400px] pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.06) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />

        {/* Foreground content */}
        <div className="relative z-20 flex flex-col items-center justify-center text-center mt-[-4vh] px-6">

          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
            <span className="text-[9px] font-mono text-white/30 tracking-[0.5em] uppercase">AI Engineering Agent</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-red-brand/40" />
          </div>

          <h1 className="flex items-baseline gap-2 md:gap-3 leading-none mb-3">
            <span
              className="font-thin text-white/60 text-[clamp(2.8rem,10vw,7.5rem)] leading-none"
              style={{ letterSpacing: '0.16em' }}
            >
              DEV
            </span>
            <span
              className="w-px bg-red-brand/30"
              style={{ alignSelf: 'center', height: '0.6em' }}
            />
            <span
              className="font-light text-[clamp(2.8rem,10vw,7.5rem)] leading-none"
              style={{
                letterSpacing: '0.16em',
                background: 'linear-gradient(160deg, #ff6070 0%, #E8192C 45%, #c01828 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 0 20px rgba(232,25,44,0.5)) drop-shadow(0 0 50px rgba(232,25,44,0.18))',
              }}
            >
              CLAW
            </span>
          </h1>

          <div className="flex items-center gap-2 mb-4">
            <div className="h-px w-10 bg-gradient-to-r from-transparent to-white/10" />
            <div className="w-1 h-1 rounded-full bg-red-brand/50" />
            <div className="w-1.5 h-1.5 rounded-full bg-red-brand/70" />
            <div className="w-1 h-1 rounded-full bg-red-brand/50" />
            <div className="h-px w-10 bg-gradient-to-l from-transparent to-white/10" />
          </div>

          <p className="text-[11px] md:text-sm text-white/35 max-w-sm mb-7 leading-relaxed tracking-[0.25em] uppercase text-center">
            Real-time code generation.<br />
            Full workflow automation.
          </p>

          <button
            onClick={onEnter}
            className="group relative inline-flex items-center gap-2 px-10 py-3 rounded-md bg-transparent border border-red-900/80 text-red-500 font-mono text-sm tracking-widest hover:border-red-brand hover:text-red-brand hover:bg-red-950/30 active:scale-95 transition-all duration-300"
          >
            ENTER <span className="ml-1 transition-transform duration-200 group-hover:translate-x-1">→</span>
          </button>
        </div>

        {/* Scroll indicator — bottom center */}
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-2 animate-bounce opacity-40">
          <span className="text-[10px] font-mono tracking-[0.2em] text-white/80">SCROLL</span>
          <svg className="w-3 h-3 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        {/* Watermark — bottom right */}
        <p className="absolute bottom-8 right-8 text-[10px] text-white/20 font-mono tracking-[0.2em] z-20">
          OPENCLAW
        </p>
      </section>

      {/* ════════════════════════════════════════════════════
          PROBLEM SECTION
      ════════════════════════════════════════════════════ */}
      <section className="relative py-32 px-6 flex flex-col items-center overflow-hidden" style={{ background: 'linear-gradient(180deg, #050505 0%, #0a0205 100%)' }}>

        {/* Large floating crab — right side */}
        <div
          className="absolute right-[-12%] top-1/2 -translate-y-1/2 w-[340px] pointer-events-none animate-float"
          style={{ opacity: 0.08, animationDelay: '1s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Mini crab — top left */}
        <div
          className="absolute top-10 left-[8%] w-[60px] pointer-events-none animate-float"
          style={{ opacity: 0.12, animationDelay: '0.5s', animationDuration: '5s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Large floating crab — left side */}
        <div
          className="absolute left-[-8%] top-[30%] w-[280px] pointer-events-none animate-float"
          style={{ opacity: 0.07, animationDelay: '2.5s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Huge crab — center, behind content */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] pointer-events-none animate-float"
          style={{ opacity: 0.06, animationDelay: '0.8s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Red glow — bottom left */}
        <div className="absolute bottom-0 left-[10%] w-[400px] h-[300px] pointer-events-none animate-glow-pulse"
          style={{ background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.12) 0%, transparent 70%)', filter: 'blur(60px)', opacity: 0.8 }} />

        {/* Red glow — top right */}
        <div className="absolute top-0 right-[5%] w-[300px] h-[250px] pointer-events-none animate-glow-pulse"
          style={{ background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.08) 0%, transparent 70%)', filter: 'blur(50px)', animationDelay: '2s' }} />

        {/* Subtle top divider glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-24 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent, rgba(232,25,44,0.3), transparent)' }}
        />

        {/* Section label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
          <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">The Problem</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-red-brand/40" />
        </div>

        <h2 className="text-2xl md:text-4xl font-thin text-white tracking-widest uppercase text-center mb-3" style={{ letterSpacing: '0.12em', textShadow: '0 0 30px rgba(232,25,44,0.35)' }}>
          Engineering is broken
        </h2>
        <p className="text-sm text-white/45 max-w-md text-center mb-16 leading-relaxed tracking-wide">
          The tools exist. The talent exists. But the workflow gets in the way.
        </p>

        <div className="w-full max-w-3xl flex flex-col gap-px">
          {PROBLEMS.map((p, i) => (
            <div
              key={p.number}
              className="group flex gap-8 px-8 py-7 border border-white/[0.08] hover:border-red-brand/40 hover:bg-red-950/10 transition-all duration-300"
              style={{ borderRadius: i === 0 ? '12px 12px 0 0' : i === PROBLEMS.length - 1 ? '0 0 12px 12px' : '0' }}
            >
              <span className="font-mono text-[11px] text-red-brand/60 group-hover:text-red-brand transition-colors mt-1 flex-shrink-0">{p.number}</span>
              <div>
                <h3 className="text-sm font-semibold text-white/80 tracking-widest uppercase mb-2" style={{ textShadow: '0 0 20px rgba(232,25,44,0.2)' }}>{p.title}</h3>
                <p className="text-sm text-white/45 leading-relaxed max-w-xl">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          SOLUTION SECTION
      ════════════════════════════════════════════════════ */}
      <section className="relative py-16 px-6 flex flex-col items-center overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0205 0%, #050505 100%)' }}>

        {/* Large floating crab — left side */}
        <div
          className="absolute left-[-10%] top-1/2 -translate-y-1/2 w-[300px] pointer-events-none animate-float"
          style={{ opacity: 0.09, animationDelay: '1.5s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Mini crab — top right */}
        <div
          className="absolute top-6 right-[10%] w-[50px] pointer-events-none animate-float"
          style={{ opacity: 0.13, animationDelay: '0.3s', animationDuration: '6s' }}
        >
          <CrabSVG className="w-full h-auto" />
        </div>

        {/* Background glow — center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.06) 0%, transparent 70%)', filter: 'blur(60px)' }} />

        {/* Red glow — top left */}
        <div className="absolute top-[5%] left-[8%] w-[280px] h-[200px] pointer-events-none animate-glow-pulse"
          style={{ background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.10) 0%, transparent 70%)', filter: 'blur(55px)', animationDelay: '1s' }} />

        {/* Red glow — bottom right */}
        <div className="absolute bottom-[5%] right-[8%] w-[350px] h-[250px] pointer-events-none animate-glow-pulse"
          style={{ background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.09) 0%, transparent 70%)', filter: 'blur(65px)', animationDelay: '3s' }} />

        {/* Section label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
          <span className="text-[9px] font-mono text-red-brand tracking-[0.5em] uppercase">The Solution</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-red-brand/40" />
        </div>

        <h2 className="text-2xl md:text-4xl font-thin text-white tracking-widest uppercase text-center mb-3" style={{ letterSpacing: '0.12em', textShadow: '0 0 30px rgba(232,25,44,0.35)' }}>
          Meet DevClaw
        </h2>
        <p className="text-sm text-white/45 max-w-md text-center mb-16 leading-relaxed tracking-wide">
          An AI agent that turns a message into a merged pull request — no IDE, no manual steps, no waiting.
        </p>

        <div className="w-full max-w-3xl grid md:grid-cols-3 gap-4">
          {SOLUTIONS.map((s) => (
            <div
              key={s.title}
              className="group flex flex-col gap-4 p-6 border border-white/[0.08] hover:border-red-brand/40 hover:bg-red-950/10 rounded-xl transition-all duration-300"
            >
              <div className="w-9 h-9 rounded-lg border border-red-brand/40 group-hover:border-red-brand flex items-center justify-center text-red-brand/70 group-hover:text-red-brand transition-all duration-300">
                {s.icon}
              </div>
              <h3 className="text-xs font-semibold text-white/80 tracking-widest uppercase" style={{ textShadow: '0 0 20px rgba(232,25,44,0.2)' }}>{s.title}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <p className="text-[10px] font-mono text-white/50 tracking-[0.4em] uppercase">Ready to ship faster?</p>
          <button
            onClick={onEnter}
            className="group inline-flex items-center gap-2 px-10 py-3 rounded-md bg-transparent border border-red-900/80 text-red-500 font-mono text-sm tracking-widest hover:border-red-brand hover:text-red-brand hover:bg-red-950/30 active:scale-95 transition-all duration-300"
          >
            GET STARTED <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
          </button>
        </div>

        {/* Footer note */}
        <p className="mt-8 text-[10px] text-white/15 font-mono tracking-[0.3em]">
          UK AI AGENT HACK EP4 · OPENCLAW
        </p>
      </section>

    </div>
  );
}
