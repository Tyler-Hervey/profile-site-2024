/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme')

export default {
  content: ['./src/**/*.{html,js,ts,astro}'],
  theme: {
    extend: {
      colors: {
        // The two colors of the dithered portrait.
        ink: '#050505',
        accent: '#7A7AFF',
        paper: '#ECECF4',
        haze: '#A3A3BE',
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        pixel: ['"Press Start 2P"', ...defaultTheme.fontFamily.mono],
      },
    },
  },
  plugins: [],
}
