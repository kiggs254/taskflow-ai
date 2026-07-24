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
        // Every colour resolves through a CSS variable (see index.css), so adding
        // `.light` to <html> re-themes the whole app. `<alpha-value>` keeps opacity
        // utilities like `bg-slate-900/20` working. The neutral `slate` scale and
        // `white` are overridden here too, because the JSX uses them directly as both
        // surfaces and text.
        white: 'rgb(var(--c-white) / <alpha-value>)',
        background: 'rgb(var(--c-background) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        secondary: 'rgb(var(--c-secondary) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        slate: {
          50: 'rgb(var(--c-slate-50) / <alpha-value>)',
          100: 'rgb(var(--c-slate-100) / <alpha-value>)',
          200: 'rgb(var(--c-slate-200) / <alpha-value>)',
          300: 'rgb(var(--c-slate-300) / <alpha-value>)',
          400: 'rgb(var(--c-slate-400) / <alpha-value>)',
          500: 'rgb(var(--c-slate-500) / <alpha-value>)',
          600: 'rgb(var(--c-slate-600) / <alpha-value>)',
          700: 'rgb(var(--c-slate-700) / <alpha-value>)',
          800: 'rgb(var(--c-slate-800) / <alpha-value>)',
          900: 'rgb(var(--c-slate-900) / <alpha-value>)',
          950: 'rgb(var(--c-slate-950) / <alpha-value>)',
        },
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
