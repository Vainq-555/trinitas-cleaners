/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0F4C81",
          dark: "#0A3A64",
          deeper: "#082E50",
          light: "#EAF2FA",
          soft: "#D6E6F5",
        },
        clean: {
          DEFAULT: "#2E8B57",
          dark: "#1F6B40",
          light: "#E8F5EE",
        },
        canvas: "#F8FAFC",
        ink: "#1E293B",
        muted: "#64748B",
        line: "#E2E8F0",
        warn: "#F59E0B",
        warnbg: "#FEF3C7",
        danger: "#DC2626",
        dangerbg: "#FEE2E2",
        okbg: "#DCFCE7",
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