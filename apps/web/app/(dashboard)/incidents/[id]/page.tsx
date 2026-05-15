import type { Metadata } from 'next';
import { IncidentDetailClient } from './IncidentDetailClient';

export const metadata: Metadata = { title: 'Incident Detail' };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}

export default async function IncidentDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { workspaceId = '' } = await searchParams;
  return <IncidentDetailClient incidentId={id} workspaceId={workspaceId} />;
}
