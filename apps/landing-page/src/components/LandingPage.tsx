import CrabSVG from './CrabSVG';

interface Props {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: Props) {
  return (
    <div className="relative min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center overflow-hidden select-none">

      {/* Subtle radial glow behind crab */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[600px] rounded-full bg-red-brand/10 blur-[120px]" />
      </div>

      {/* Crab — large, centred, slightly behind text */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[min(90vw,560px)] opacity-80 pointer-events-none">
        <CrabSVG className="w-full h-auto drop-shadow-[0_0_60px_rgba(232,25,44,0.35)]" />
      </div>

      {/* Foreground content */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center pb-40">
        {/* Logo mark */}
        <div className="w-12 h-12 bg-red-brand rounded-xl flex items-center justify-center shadow-lg shadow-red-brand/40 mb-2">
          <span className="text-white font-black font-mono text-lg">DC</span>
        </div>

        {/* Title */}
        <h1 className="text-[clamp(3.5rem,12vw,8rem)] font-black text-white leading-none tracking-tighter">
          Dev<span className="text-red-brand">Claw</span>
        </h1>

        {/* Tagline — 5 iconic words */}
        <p className="text-[clamp(1rem,3vw,1.5rem)] font-medium text-white/50 tracking-wide uppercase">
          AI agents. Real pull requests.
        </p>

        {/* Enter button */}
        <button
          onClick={onEnter}
          className="
            mt-4 group relative inline-flex items-center gap-3
            px-10 py-4 rounded-full
            bg-red-brand text-white font-bold text-lg
            shadow-[0_0_40px_rgba(232,25,44,0.4)]
            hover:shadow-[0_0_60px_rgba(232,25,44,0.6)]
            hover:scale-105 active:scale-95
            transition-all duration-300
          "
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
      <p className="absolute bottom-5 right-6 text-xs text-white/20 font-mono">
        UK AI Agent Hack EP4 · OpenClaw
      </p>
    </div>
  );
}
