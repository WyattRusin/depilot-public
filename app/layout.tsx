import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/schibsted-grotesk';
import './globals.css';
import { APP_NAME } from '@/lib/app-config';
import { THEME_BOOT } from '@/lib/client/theme';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Your Depop listings, written and priced from a few photos.',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF8' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
