// Tailwind v4 ships its own PostCSS plugin; there is no tailwind.config.js and no
// autoprefixer (v4 handles vendor prefixing itself).
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
