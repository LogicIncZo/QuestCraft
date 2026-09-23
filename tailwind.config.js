/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './index.tsx',
        './App.tsx',
        './components/**/*.{ts,tsx}',
        './utils/**/*.{ts,tsx}',
        './services/**/*.{ts,tsx}',
        './shared/**/*.{ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                // "The Game Table": felt chrome, printed paper components,
                // brass as the single accent. Quest data (property bands,
                // player tokens, resource bars) uses stock palette colors.
                felt: {
                    900: '#0B241E',
                    800: '#103028',
                    700: '#164035',
                    600: '#1E5244',
                    500: '#2A6B59',
                },
                paper: {
                    DEFAULT: '#F3EEE2',
                    dim: '#E4DBC6',
                },
                ink: {
                    DEFAULT: '#22302B',
                    soft: '#5C6E64',
                },
                brass: {
                    DEFAULT: '#D9A13B',
                    bright: '#E8BA5F',
                    deep: '#A87818',
                },
                sage: '#9FB7A9',
                clay: {
                    DEFAULT: '#C05540',
                    deep: '#A44330',
                },
            },
            fontFamily: {
                sans: ['"Atkinson Hyperlegible"', 'sans-serif'],
                display: ['"Bricolage Grotesque"', 'sans-serif'],
                mono: ['"Spline Sans Mono"', 'monospace'],
            },
            keyframes: {
                'fade-in': {
                    '0%': { opacity: '0', transform: 'translateY(4px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'dice-roll': {
                    '0%, 100%': { transform: 'rotate(0deg) scale(1)' },
                    '25%': { transform: 'rotate(15deg) scale(1.1)' },
                    '50%': { transform: 'rotate(-15deg) scale(1.1)' },
                    '75%': { transform: 'rotate(5deg) scale(1.1)' },
                },
                'token-move': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-10px)' },
                },
            },
            animation: {
                'fade-in': 'fade-in 0.4s ease-out',
                'dice-roll': 'dice-roll 0.5s ease-in-out',
                'token-move': 'token-move 0.3s ease-in-out',
            },
            typography: (theme) => ({
                DEFAULT: {
                    css: {
                        '--tw-prose-body': theme('colors.paper'),
                        '--tw-prose-headings': theme('colors.brass.bright'),
                        '--tw-prose-lead': theme('colors.sage'),
                        '--tw-prose-links': theme('colors.brass.bright'),
                        '--tw-prose-bold': theme('colors.paper'),
                        '--tw-prose-counters': theme('colors.sage'),
                        '--tw-prose-bullets': theme('colors.sage'),
                        '--tw-prose-hr': theme('colors.felt.600'),
                        '--tw-prose-quotes': theme('colors.paper'),
                        '--tw-prose-quote-borders': theme('colors.felt.500'),
                        '--tw-prose-captions': theme('colors.sage'),
                        '--tw-prose-code': theme('colors.brass.bright'),
                        '--tw-prose-pre-code': theme('colors.brass.bright'),
                        '--tw-prose-pre-bg': theme('colors.felt.900'),
                        '--tw-prose-th-borders': theme('colors.felt.600'),
                        '--tw-prose-td-borders': theme('colors.felt.700'),
                    },
                },
            }),
        },
    },
    plugins: [require('@tailwindcss/typography')],
};
