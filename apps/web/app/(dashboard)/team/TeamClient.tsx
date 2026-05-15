'use client';

import { useState, useEffect } from 'react';
import { api } from '../../../lib/api-client';
import type { WorkspaceMember, NotificationChannel } from '@pulseway/types';

interface Props {
  workspaceId: string;
}

export function TeamClient({ workspaceId }: Props) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ data: WorkspaceMember[] }>(`/team/workspace/${workspaceId}/members`),
      api.get<{ data: NotificationChannel[] }>(`/team/workspace/${workspaceId}/channels`),
    ])
      .then(([mRes, cRes]) => {
        setMembers(mRes.data);
        setChannels(cRes.data);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-white/5" />;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-5 text-sm font-semibold text-gray-200">Members</h2>
        <ul className="divide-y divide-white/5">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-200">{m.user?.name ?? m.userId}</p>
                <p className="text-xs text-gray-500">{m.user?.email}</p>
              </div>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs capitalize text-gray-400">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-white/5 bg-white/2 p-6">
        <h2 className="mb-5 text-sm font-semibold text-gray-200">Alert Channels</h2>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-500">No alert channels configured.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {channels.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium capitalize text-gray-200">{ch.channelType}</p>
                  <p className="text-xs text-gray-500">
                    {ch.channelType === 'email' ? ch.config['to'] : ch.config['webhookUrl']}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    ch.isActive
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-gray-500/10 text-gray-400'
                  }`}
                >
                  {ch.isActive ? 'Active' : 'Disabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
