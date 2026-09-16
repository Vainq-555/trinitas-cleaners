/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--color-brand) / <alpha-value>)",
          dark: "rgb(var(--color-brand-dark) / <alpha-value>)",
          deeper: "rgb(var(--color-brand-deeper) / <alpha-value>)",
          light: "rgb(var(--color-brand-light) / <alpha-value>)",
          soft: "rgb(var(--color-brand-soft) / <alpha-value>)",
        },
        clean: {
          DEFAULT: "rgb(var(--color-clean) / <alpha-value>)",
          dark: "rgb(var(--color-clean-dark) / <alpha-value>)",
          light: "rgb(var(--color-clean-light) / <alpha-value>)",
        },
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
        warnbg: "rgb(var(--color-warnbg) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        dangerbg: "rgb(var(--color-dangerbg) / <alpha-value>)",
        okbg: "rgb(var(--color-okbg) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)",
        lift: "0 12px 28px rgba(15, 23, 42, 0.14), 0 4px 10px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};