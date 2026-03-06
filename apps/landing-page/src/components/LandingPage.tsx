// Background imported externally
interface Props {
  onEnter: () => void;
  onAdmin: () => void;
}

// Static star field — generated once, stable positions
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: ((i * 137.508) % 100),       // golden-angle pseudo-random spread
  y: ((i * 97.346 + 13) % 100),
  size: i % 5 === 0 ? 2 : i % 3 === 0 ? 1.5 : 1,
  delay: (i * 0.13) % 4,
  duration: 2.5 + (i % 3) * 0.8,
}));

export default function LandingPage({ onEnter, onAdmin }: Props) {
  return (
    <div className="relative h-screen bg-[#050505] flex flex-col items-center justify-center overflow-hidden select-none">

      {/* ── Film grain overlay ── */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* ── Star field ── */}
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

      {/* ── Deep vignette for general darkening ── */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(circle at center, transparent 10%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.95) 100%)',
        }}
      />

      {/* ── Center Earth Background Image ── */}
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
          {/* Red tint overlay */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: 'radial-gradient(ellipse at 40% 45%, rgba(232,25,44,0.3) 0%, rgba(100,10,18,0.15) 50%, transparent 75%)', mixBlendMode: 'overlay' }}
          />
          {/* Edge fade so it blends into the bg */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: 'inset 0 0 80px 40px #050505' }}
          />
        </div>
      </div>

      {/* ── Scan line ── */}
      <div className="absolute inset-0 pointer-events-none z-5 overflow-hidden" aria-hidden="true">
        <div className="scan-line" />
      </div>

      {/* ── Pulsing red glow — floor ── */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] pointer-events-none animate-glow-pulse"
        style={{
          background: 'radial-gradient(ellipse at center bottom, #E8192C 0%, transparent 65%)',
          filter: 'blur(60px)',
          opacity: 0.1,
        }}
      />

      {/* ── Secondary ambient glow — upper left ── */}
      <div
        className="absolute top-[-10%] left-[-5%] w-[500px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.06) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />


      {/* ── Foreground content ── */}
      <div className="relative z-20 flex flex-col items-center justify-center text-center mt-[-4vh] px-6">

        {/* Pre-label */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-red-brand/40" />
          <span className="text-[9px] font-mono text-white/30 tracking-[0.5em] uppercase">AI Engineering Agent</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-red-brand/40" />
        </div>

        {/* Title */}
        <h1 className="flex items-baseline gap-2 md:gap-3 leading-none mb-3">
          {/* DEV — thin, tracked, slightly faded */}
          <span
            className="font-thin text-white/60 text-[clamp(2.8rem,10vw,7.5rem)] leading-none"
            style={{ letterSpacing: '0.16em' }}
          >
            DEV
          </span>

          {/* Vertical separator */}
          <span
            className="w-px bg-red-brand/30"
            style={{ alignSelf: 'center', height: '0.6em' }}
          />

          {/* CLAW — light weight, gradient, glowing */}
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

        {/* Accent dots row */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-px w-10 bg-gradient-to-r from-transparent to-white/10" />
          <div className="w-1 h-1 rounded-full bg-red-brand/50" />
          <div className="w-1.5 h-1.5 rounded-full bg-red-brand/70" />
          <div className="w-1 h-1 rounded-full bg-red-brand/50" />
          <div className="h-px w-10 bg-gradient-to-l from-transparent to-white/10" />
        </div>

        {/* Subtitle */}
        <p className="text-[11px] md:text-sm text-white/35 max-w-sm mb-7 leading-relaxed tracking-[0.25em] uppercase text-center">
          Real-time code generation.<br />
          Full workflow automation.
        </p>

        {/* Enter button */}
        <button
          onClick={onEnter}
          className="group relative inline-flex items-center gap-2 px-10 py-3 rounded-md bg-transparent border border-red-900/80 text-red-500 font-mono text-sm tracking-widest hover:border-red-brand hover:text-red-brand hover:bg-red-950/30 active:scale-95 transition-all duration-300"
        >
          ENTER <span className="ml-1 transition-transform duration-200 group-hover:translate-x-1">→</span>
        </button>

      </div>

      {/* Admin link — bottom left */}
      <button
        onClick={onAdmin}
        className="absolute bottom-8 left-8 z-20 text-[10px] text-white/20 hover:text-white/60 font-mono tracking-[0.2em] transition-colors duration-200"
      >
        ADMIN
      </button>

      {/* Scroll indicator — bottom center */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce cursor-pointer opacity-40 hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-mono tracking-[0.2em] text-white/80">SCROLL</span>
        <svg className="w-3 h-3 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>

      {/* Corner watermark */}
      <p className="absolute bottom-8 right-8 text-[10px] text-white/20 font-mono tracking-[0.2em] z-20">
        OPENCLAW
      </p>
    </div>
  );
}
