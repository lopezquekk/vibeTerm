/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#1a1a1a",
        "sidebar-active": "#2a2a2a",
        "sidebar-hover": "#222222",
        surface: "#0f0f0f",
        border: "#2a2a2a",
        accent: "#3b82f6",
        "git-add": "#4ade80",
        "git-remove": "#f87171",
        "git-dirty": "#fbbf24",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
};
