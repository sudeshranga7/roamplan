// Sunset over the sea: decorative, drawn in SVG so it stays crisp and costs nothing to load.
export default function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sky-1)" />
          <stop offset=".55" stopColor="var(--sky-2)" />
          <stop offset="1" stopColor="var(--sky-3)" />
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sea-1)" />
          <stop offset="1" stopColor="var(--sea-2)" />
        </linearGradient>
      </defs>
      <rect width="1200" height="420" fill="url(#sky)" />
      <circle className="sun" cx="860" cy="270" r="90" fill="var(--sun)" />
      <path className="plane-trail" d="M120 120 C 320 60, 520 90, 700 70" fill="none" stroke="var(--trail)" strokeWidth="2" strokeDasharray="6 9" strokeLinecap="round" />
      <path className="plane" d="M700 70 l22 -4 l8 -10 l5 1 l-4 11 l14 -2 l5 -6 l4 1 l-3 7 l3 6 l-4 1 l-5 -5 l-14 1 l4 11 l-5 1 l-8 -10 l-22 -3 z" fill="var(--trail)" />
      <path d="M0 290 Q 150 270 300 290 T 600 290 T 900 290 T 1200 290 V420 H0 Z" fill="url(#sea)" />
      <path className="wave w1" d="M0 315 Q 100 300 200 315 T 400 315 T 600 315 T 800 315 T 1000 315 T 1200 315 T 1400 315" fill="none" stroke="var(--foam)" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <path className="wave w2" d="M-100 350 Q 0 337 100 350 T 300 350 T 500 350 T 700 350 T 900 350 T 1100 350 T 1300 350" fill="none" stroke="var(--foam)" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <g className="palm" fill="var(--palm)" transform="translate(880 0)">
        <path d="M170 420 C 175 360 185 300 210 240 L 216 242 C 194 302 186 362 184 420 Z" />
        <path d="M212 240 C 180 215 140 215 110 235 C 145 225 180 230 212 245 Z" />
        <path d="M212 240 C 205 205 180 185 150 182 C 178 195 198 215 210 245 Z" />
        <path d="M213 240 C 230 205 262 192 292 198 C 262 205 238 222 216 246 Z" />
        <path d="M213 241 C 250 228 285 238 305 262 C 280 245 248 240 215 247 Z" />
        <path d="M212 241 C 175 248 150 270 142 300 C 160 272 185 256 214 248 Z" />
      </g>
    </svg>
  );
}
