import CrabSVG from './CrabSVG';

interface Props {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: Props) {
  return (
    <div className="relative h-screen bg-[#050505] flex flex-col items-center justify-center overflow-hidden select-none">

      {/* ── Film grain overlay ── */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* ── Deep vignette ── */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.92) 100%)',
        }}
      />

      {/* ── Pulsing red glow — sits behind crab, kept subtle ── */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] pointer-events-none animate-glow-pulse"
        style={{
          background: 'radial-gradient(ellipse at center bottom, #E8192C 0%, transparent 70%)',
          filter: 'blur(80px)',
          opacity: 0.18,
        }}
      />

      {/* ── Crab — large but muted so text stays legible ── */}
      <div
        className="absolute bottom-[-4%] left-1/2 -translate-x-1/2 w-[min(110vw,900px)] pointer-events-none animate-float"
        style={{ opacity: 0.28 }}
      >
        <CrabSVG
          className="w-full h-auto"
          style={{ filter: 'drop-shadow(0 0 40px rgba(232,25,44,0.2))' }}
        />
      </div>

      {/* ── Foreground content ── */}
      <div className="relative z-20 flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">

        {/* Logo mark */}
        <div className="w-12 h-12 bg-red-brand rounded-xl flex items-center justify-center shadow-lg shadow-red-brand/50 mb-1">
          <span className="text-white font-black font-mono text-lg">DC</span>
        </div>

        {/* Title */}
        <h1 className="text-[clamp(4rem,14vw,9rem)] font-black text-white leading-none tracking-tighter drop-shadow-[0_2px_40px_rgba(0,0,0,0.8)]">
          Dev<span className="text-red-brand" style={{ textShadow: '0 0 40px rgba(232,25,44,0.6)' }}>Claw</span>
        </h1>

        {/* Tagline */}
        <p className="text-[clamp(0.9rem,2.5vw,1.35rem)] font-medium text-white/45 tracking-[0.2em] uppercase">
          AI agents.&nbsp; Real pull requests.
        </p>

        {/* Enter button */}
        <button
          onClick={onEnter}
          className="
            mt-5 group relative inline-flex items-center gap-3
            px-11 py-4 rounded-full
            bg-red-brand text-white font-bold text-lg
            hover:scale-105 active:scale-95
            transition-all duration-300
          "
          style={{
            boxShadow: '0 0 30px rgba(232,25,44,0.5), 0 0 80px rgba(232,25,44,0.2)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 0 50px rgba(232,25,44,0.7), 0 0 120px rgba(232,25,44,0.35)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 0 30px rgba(232,25,44,0.5), 0 0 80px rgba(232,25,44,0.2)';
          }}
        >
          Enter
          <svg
            className="w-5 h-5 translate-x-0 group-hover:translate-x-1 transition-transform duration-200"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>

      {/* Corner watermark */}
      <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-center text-[11px] text-white/15 font-mono z-20 tracking-wider">
        UK AI Agent Hack EP4 · OpenClaw
      </p>
    </div>
  );
}
