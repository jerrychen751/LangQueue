/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './popup.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      width: {
        popup: '400px',
      },
      minWidth: {
        popup: '400px',
      },
      maxWidth: {
        popup: '400px',
      },
    },
  },
  plugins: [],
}


