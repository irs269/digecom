/** @type {import('next').NextConfig} */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // ESLint et tsc tournent dans `make lint` ; inutile de les relancer pendant `next build`.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@digecom/shared'],
  // Le navigateur appelle /api/... ; Next.js relaie vers le conteneur api (même origine → cookie
  // httpOnly du refresh token envoyé sans CORS).
  // Ancienne adresse de la PWA (/app) : les icônes déjà installées sur iPhone y renvoient encore.
  // /pwa est choisi car aucun écran ne commence par « pwa » (« /appels » était confondu avec /app).
  async redirects() {
    return [
      { source: '/app', destination: '/pwa', permanent: false },
      { source: '/app/:path*', destination: '/pwa', permanent: false },
    ];
  },
  async rewrites() {
    return {
      // PWA (application mobile exportée dans public/pwa) : les écrans de l'application
      // renvoient son index, qui gère sa propre navigation ; les fichiers statiques sont servis tels quels.
      beforeFiles: [
        { source: '/pwa', destination: '/pwa/index.html' },
        {
          source: '/pwa/:path((?!_expo/|assets/|icons/|sw\\.js|manifest\\.json|favicon).*)',
          destination: '/pwa/index.html',
        },
      ],
      afterFiles: [{ source: '/api/:path*', destination: `${apiInternalUrl}/:path*` }],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // PWA : fichiers JavaScript et images au nom versionné (empreinte) → cache d'un an,
      // l'application s'ouvre ensuite sans retélécharger 300 Ko en 4G.
      {
        source: '/pwa/_expo/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/pwa/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
