import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: "Dig'eCom – Back-office", template: "%s · Dig'eCom" },
  description: 'Plateforme de gestion commerciale, logistique et financière',
  icons: { icon: '/logo.jpg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B2FE0',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={poppins.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
