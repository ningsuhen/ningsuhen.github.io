/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme")
const plugin = require("tailwindcss/plugin")
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,mjs}"],
  darkMode: "class", // allows toggling dark mode manually
  theme: {
    extend: {
      fontFamily: {
        sans: ["Roboto", "sans-serif", ...defaultTheme.fontFamily.sans],
      },
      // Text floor: the root is 14px below md (Layout.astro), so plain 0.75rem would render 10.5px. 12px at every width.
      fontSize: {
        xs: ["max(0.75rem, 12px)", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    // Shared component classes. They are registered here, not in src/styles/main.css, because
    // Tailwind resolves @apply only against classes already registered in the process. A class
    // defined in main.css is missing whenever markdown.css (which @applies it) is transformed first.
    plugin(({ addComponents }) => {
      addComponents({
        ".expand-animation": {
          "@apply relative before:ease-out before:transition active:bg-none hover:before:bg-[var(--btn-plain-bg-hover)] active:before:bg-[var(--btn-plain-bg-active)] z-0 before:absolute before:rounded-[inherit] before:inset-0 before:scale-[0.85] hover:before:scale-100 before:-z-10": {},
        },
        ".link": {
          "@apply transition rounded-md p-1 -m-1 expand-animation": {},
        },
        ".link-lg": {
          "@apply transition rounded-md p-1.5 -m-1.5 expand-animation": {},
        },
        ".btn-regular-dark": {
          "@apply flex items-center justify-center bg-[oklch(0.45_0.01_var(--hue))] hover:bg-[oklch(0.50_0.01_var(--hue))] active:bg-[oklch(0.55_0.01_var(--hue))] dark:bg-[oklch(0.30_0.02_var(--hue))] dark:hover:bg-[oklch(0.35_0.03_var(--hue))] dark:active:bg-[oklch(0.40_0.03_var(--hue))]": {},
        },
        ".btn-regular-dark.success": {
          "@apply bg-[oklch(0.75_0.14_var(--hue))] dark:bg-[oklch(0.75_0.14_var(--hue))]": {},
        },
      })
    }),
  ],
}
