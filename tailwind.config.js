const fs = require('fs');
const colors = JSON.parse(
  fs.readFileSync('colors.json', { encoding: 'utf-8' })
);

module.exports = {
  darkMode: 'class',
  purge: false,
  theme: {
    fontFamily: {
      sans: ['Inter', 'sans-serif'],
    },
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    fontSize: {
      xs: '12px',
      sm: '13px',
      base: '14px',
      lg: '15px',
      xl: '18px',
      '2xl': '21px',
      '3xl': '25px',
      '4xl': '30px',
    },
    extend: {
      maxHeight: {
        64: '16rem',
      },
      minWidth: {
        40: '10rem',
        56: '14rem',
      },
      maxWidth: {
        32: '8rem',
        56: '14rem',
      },
      spacing: {
        7: '1.75rem',
        14: '3.5rem',
        18: '4.5rem',
        28: '7rem',
        72: '18rem',
        80: '20rem',
      },
      boxShadow: {
        'outline-px': '0 0 0 1px rgba(67, 97, 238, 0.5)',
        DEFAULT: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
        md: '0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 4px 12px -2px rgba(15, 23, 42, 0.06)',
        lg: '0 4px 6px -2px rgba(15, 23, 42, 0.05), 0 12px 28px -6px rgba(15, 23, 42, 0.14)',
        button: '0 1px 2px 0 rgba(15, 23, 42, 0.08)',
        ring: '0 0 0 3px rgba(67, 97, 238, 0.18)',
      },
      borderRadius: {
        sm: '0.375rem', // 6px
        DEFAULT: '0.5rem', // 8px
        md: '0.625rem', // 10px
        lg: '0.75rem', // 12px
        xl: '1rem', // 16px
      },
      gridColumn: {
        'span-full': '1 / -1',
      },
      colors,
    },
  },
  variants: {
    margin: ['responsive', 'first', 'last', 'hover', 'focus'],
    backgroundColor: [
      'responsive',
      'first',
      'hover',
      'focus',
      'focus-within',
      'dark',
    ],
    display: ['group-hover'],
    borderWidth: ['last'],
    fontWeight: ['dark'],
  },
  plugins: [require('tailwindcss-rtl')],
};

/*
 * 208, 100, 50
 * 209,  62, 50
 */
