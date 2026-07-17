/** @type {import('tailwindcss').Config} */
//
// Transcribed verbatim from the inline `tailwind.config` that lived in a <script>
// tag in index.html alongside the CDN build. The CDN ships a ~400KB in-browser
// compiler that re-scans the DOM with a MutationObserver and regenerates the
// stylesheet on every mutation -- i.e. on every 15s poll tick.
//
// Tailwind v3, not v4, deliberately: this config maps 1:1 onto v3, whereas v4's
// CSS-first config and renamed utilities would layer a second, silent visual diff
// underneath the intended refresh and make regressions unattributable.
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        surface: '#1e293b',
        primary: '#3b82f6',
        secondary: '#64748b',
        accent: '#f43f5e',
        success: '#10b981',
        warning: '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pop-in': 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.5)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
