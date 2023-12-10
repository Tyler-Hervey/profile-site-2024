/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

export default {
  content: ['./src/**/*.{html,js,astro}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Oswald', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
