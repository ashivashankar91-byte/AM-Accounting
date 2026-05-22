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
        // Brand — single source of truth for primary actions
        brand: {
          DEFAULT: '#1D4ED8',
          hover:   '#1E40AF',
          light:   '#EFF6FF',
          border:  '#BFDBFE',
          ring:    '#93C5FD',
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
