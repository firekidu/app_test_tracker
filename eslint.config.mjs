import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'node_modules/**', '.data/**', 'next-env.d.ts', 'lib/common-passwords.ts'] },
  {
    rules: {
      '@next/next/no-img-element': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      // Full page loads are intended after sign-in/out so cookies and server guards apply.
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
];
export default config;
