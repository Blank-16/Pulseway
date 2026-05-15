import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

const NAV_ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/monitors', label: 'Monitors' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/team', label: 'Team' },
  { href: '/billing', label: 'Billing' },
  { href: '/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-white/5 bg-gray-900">
        <div className="flex h-14 items-center px-5">
          <span className="text-lg font-bold tracking-tight text-white">Pulseway</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="ml-56 flex-1 p-8">{children}</main>
    </div>
  );
}
