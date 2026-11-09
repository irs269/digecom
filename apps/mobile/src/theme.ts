/** Thème Dig'eCom (prototype mobile) : bleu, orange, Poppins. */
export const colors = {
  blue: '#0B2FE0',
  blueDark: '#071C99',
  blueSoft: '#DCE3FF',
  orange: '#FFA500',
  orangeSoft: '#FFF1D6',
  green: '#12A150',
  greenSoft: '#DDF5E7',
  red: '#D92D20',
  redSoft: '#FDE4E2',
  ink: '#0F1530',
  muted: '#5B6385',
  line: '#E1E5F2',
  bg: '#F4F6FC',
  white: '#FFFFFF',
} as const;

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

export const radius = { sm: 10, md: 14, lg: 20 } as const;

export const toneColors = {
  green: { fg: colors.green, bg: colors.greenSoft },
  orange: { fg: '#B86E00', bg: colors.orangeSoft },
  blue: { fg: colors.blue, bg: colors.blueSoft },
  red: { fg: colors.red, bg: colors.redSoft },
} as const;
