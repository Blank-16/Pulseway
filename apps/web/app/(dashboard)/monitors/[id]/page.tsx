import type { Metadata } from 'next';
import { MonitorDetailClient } from './MonitorDetailClient';

export const metadata: Metadata = { title: 'Monitor Detail' };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}

export default async function MonitorDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { workspaceId = '' } = await searchParams;

  return <MonitorDetailClient monitorId={id} workspaceId={workspaceId} />;
}
