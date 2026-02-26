import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0F0F14',
        surface: '#1A1A24',
        card: '#1E1E2E',
        nav: '#0C0C16',
        hover: '#1A1A24',
        active: '#7C3AED',
        primary: '#7C3AED',
        primaryLight: '#8B5CF6',
        primaryDark: '#6D28D9',
        accent: '#06B6D4',
        border: '#2A2A3C',
        borderLight: '#3F3F5C',
        text: '#E2E8F0',
        textSecondary: '#94A3B8',
        textMuted: '#64748B',
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #7C3AED, 0 0 10px #7C3AED' },
          '100%': { boxShadow: '0 0 10px #8B5CF6, 0 0 20px #8B5CF6, 0 0 30px #8B5CF6' },
        },
      },
    },
  },
  plugins: [],
}

export default config
