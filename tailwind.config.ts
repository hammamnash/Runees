import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#000000",
        bone: "#ffffff",
        ash: "#9a9a9a",
        mist: "#bdbdbd",
        iris: "#8052ff",
        saffron: "#ffb829",
        verdant: "#15846e",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        display: "-0.04em",
        nav: "0.025em",
      },
      borderRadius: {
        card: "24px",
        pill: "22.5px",
      },
    },
  },
  plugins: [],
};
export default config;
