/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        ui:   ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', '"SF Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        // Brand — single source of truth for primary actions.
        // Golden R0 Phase — token alignment: routed through CSS custom
        // properties so the approved Claude Design palette (#0B5CAB primary)
        // can be applied ONLY inside the golden-path report/journal
        // foundation (the `.gr0-scope` wrapper in index.css defines the
        // --gr0-* overrides) without recoloring the many unrelated
        // pages/accounting/* screens that already use Btn/Badge/PageHeader
        // with this same `brand` token. Each fallback is the exact
        // pre-existing value, so anywhere `.gr0-scope` isn't present renders
        // byte-identical to before this change.
        brand: {
          DEFAULT: 'var(--gr0-primary, #1D4ED8)',
          hover:   'var(--gr0-primary-hover, #1E40AF)',
          light:   'var(--gr0-primary-light, #EFF6FF)',
          border:  'var(--gr0-primary-border, #BFDBFE)',
          ring:    'var(--gr0-primary-ring, #93C5FD)',
        },
        // Golden R0 Phase — approved design's navy "section head" colour
        // (#1E3A5C), additive token, scoped the same way via --gr0-navy.
        navy: {
          DEFAULT: 'var(--gr0-navy, #1E3A5C)',
        },
        // Surface hierarchy
        surface: {
          app:      '#F8FAFC',
          elevated: '#FFFFFF',
        },
        // Semantic status
        success: '#059669',
        warning: '#D97706',
        danger:  '#DC2626',
        // Financial indicator
        margin: {
          good: '#059669',
          warn: '#D97706',
          bad:  '#DC2626',
        },
        // Legacy amacc tokens (kept for backwards compat)
        amacc: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a5f',
        },
      },
    },
  },
  plugins: [],
};
