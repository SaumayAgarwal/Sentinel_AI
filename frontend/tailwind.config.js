/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: "#0a0e1a",
        cardBg: "rgba(18, 26, 47, 0.75)",
        cardBorder: "rgba(30, 41, 59, 0.8)",
        electricBlue: "#00d4ff",
        neonGreen: "#00ff88",
        alertRed: "#ff4444",
        warningYellow: "#ffbb00"
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'sans-serif']
      }
    },
  },
  plugins: [],
}
