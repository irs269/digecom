import type { Config } from 'tailwindcss';

/** Charte Dig'eCom (CLAUDE.md). */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      sm: '640px',
      // Sous 900 px, le menu passe au-dessus du contenu.
      desk: '900px',
      lg: '1200px',
    },
    extend: {
      colors: {
        brand: {
          blue: '#0B2FE0',
          'blue-dark': '#071C99',
          'blue-soft': '#DCE3FF',
          orange: '#FFA500',
          'on-orange': '#0A1450',
        },
        ink: { DEFAULT: '#0F1535', muted: '#4A5275' },
        surface: { DEFAULT: '#F3F5FC', border: '#E1E5F2' },
        status: {
          'green-bg': '#DDF5E5',
          'green-fg': '#14532D',
          'orange-bg': '#FFF0D1',
          'orange-fg': '#7A4100',
          'blue-bg': '#E6EBFF',
          'blue-fg': '#0A23B8',
          'red-bg': '#FDE2E2',
          'red-fg': '#991B1B',
        },
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        md: '12px',
        lg: '14px',
        xl: '18px',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
};

export default config;
