import type { Metadata } from 'next';

interface MonitorStatus {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  hasOpenIncident: boolean;
}

interface StatusData {
  workspace: { name: string; slug: string };
  overallStatus: 'operational' | 'partial_outage' | 'major_outage';
  monitors: MonitorStatus[];
  openIncidents: unknown[];
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Status — ${slug}` };
}

const OVERALL_STYLES = {
  operational: { text: 'All systems operational', bg: 'bg-green-500/10', fg: 'text-green-400', dot: 'bg-green-400' },
  partial_outage: { text: 'Partial outage', bg: 'bg-yellow-500/10', fg: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse' },
  major_outage: { text: 'Major outage', bg: 'bg-red-500/10', fg: 'text-red-400', dot: 'bg-red-400 animate-pulse' },
} as const;

async function fetchStatus(slug: string): Promise<StatusData | null> {
  const apiBase = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000/api';
  try {
    const res = await fetch(`${apiBase}/status/${slug}`, {
      next: { revalidate: 30 }, // ISR: revalidate every 30s
    });
    if (!res.ok) return null;
    const json = await res.json() as { data: StatusData };
    return json.data;
  } catch {
    return null;
  }
}

export default async function StatusPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await fetchStatus(slug);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">Status page not found.</p>
      </div>
    );
  }

  const style = OVERALL_STYLES[data.overallStatus];

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-gray-100">{data.workspace.name}</h1>
        <p className="mt-2 text-sm text-gray-400">System status</p>
      </div>

      <div className={`mb-8 flex items-center gap-3 rounded-xl p-5 ${style.bg}`}>
        <span className={`h-3 w-3 rounded-full ${style.dot}`} />
        <span className={`text-base font-semibold ${style.fg}`}>{style.text}</span>
      </div>

      <div className="space-y-3">
        {data.monitors.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-white/2 px-5 py-4"
          >
            <div>
              <p className="text-sm font-medium text-gray-200">{m.name}</p>
              <p className="text-xs text-gray-500">{m.url}</p>
            </div>
            <span
              className={`flex items-center gap-1.5 text-sm font-medium ${
                m.hasOpenIncident ? 'text-red-400' : 'text-green-400'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  m.hasOpenIncident ? 'bg-red-400 animate-pulse' : 'bg-green-400'
                }`}
              />
              {m.hasOpenIncident ? 'Incident' : 'Operational'}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-gray-600">
        Powered by Pulseway · Updates every 30 seconds
      </p>
    </div>
  );
}
