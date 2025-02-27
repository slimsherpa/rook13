import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        navy: {
          700: '#1a365d',
          800: '#153e75',
          900: '#1e3a8a',
          950: '#0f2447',
        },
      },
      fontFamily: {
        orbitron: ['var(--font-orbitron)'],
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glitch': 'glitch 0.2s ease-in-out',
        'circuit-1': 'circuit 2s infinite',
        'circuit-2': 'circuit 3s infinite 0.5s',
        'scanline': 'scanline 8s linear infinite',
        'flicker': 'flicker 0.15s infinite',
        'float': 'float 3s ease-in-out infinite',
        'fade-in-out': 'fadeInOut 3s ease-in-out',
        'sorting': 'sorting 0.6s ease-in-out',
        'fall': 'fall 3s linear forwards',
      },
      keyframes: {
        glitch: {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-5px, 5px)' },
          '40%': { transform: 'translate(-5px, -5px)' },
          '60%': { transform: 'translate(5px, 5px)' },
          '80%': { transform: 'translate(5px, -5px)' },
        },
        circuit: {
          '0%': { strokeDasharray: '0 100', opacity: '0.2' },
          '50%': { opacity: '1' },
          '100%': { strokeDasharray: '100 0', opacity: '0.2' },
        },
        scanline: {
          '0%': { transform: 'translateY(0%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        fadeInOut: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '10%': { opacity: '1', transform: 'translateY(0)' },
          '80%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        sorting: {
          '0%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-15px)' },
          '100%': { transform: 'translateY(0)' },
        },
        fall: {
          '0%': { transform: 'translateY(-20px) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(100vh) rotate(360deg)', opacity: '0' },
        },
      },
      transitionDelay: {
        '150': '150ms',
        '300': '300ms',
      }
    },
  },
  plugins: [],
};
export default config;
