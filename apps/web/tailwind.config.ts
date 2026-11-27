import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#242723", muted: "#74776f", paper: "#f7f6f2", line: "#e8e6df", accent: "#536c5c" } } },
  plugins: [],
} satisfies Config;
