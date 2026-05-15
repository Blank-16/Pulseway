import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Pulseway', template: '%s | Pulseway' },
  description: 'API health monitoring that alerts in under 200ms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-50 antialiased">{children}</body>
    </html>
  );
}
