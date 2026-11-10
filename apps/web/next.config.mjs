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
  async rewrites() {
    return {
      // PWA (application mobile exportée dans public/app) : les écrans de l'application
      // renvoient son index, qui gère sa propre navigation ; les fichiers statiques sont servis tels quels.
      beforeFiles: [
        { source: '/app', destination: '/app/index.html' },
        {
          source: '/app/:path((?!_expo/|assets/|icons/|sw\\.js|manifest\\.json|favicon).*)',
          destination: '/app/index.html',
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
    ];
  },
};

export default nextConfig;
