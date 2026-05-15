import type { IncidentTimelineEvent } from '@pulseway/types';

const EVENT_STYLES: Record<string, string> = {
  incident_opened: 'bg-red-500',
  incident_acknowledged: 'bg-yellow-500',
  incident_resolved: 'bg-green-500',
  alert_sent: 'bg-blue-500',
  note_added: 'bg-gray-500',
};

interface Props {
  events: IncidentTimelineEvent[];
}

export function IncidentTimeline({ events }: Props) {
  return (
    <ol className="relative ml-3 border-l border-white/10">
      {events.map((event, i) => (
        <li key={event.id} className={`ml-6 ${i < events.length - 1 ? 'mb-6' : ''}`}>
          <span
            className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-gray-950 ${EVENT_STYLES[event.eventType] ?? 'bg-gray-600'}`}
          />
          <p className="text-sm font-medium text-gray-200">{event.message}</p>
          <time className="mt-0.5 block text-xs text-gray-500">
            {new Date(event.createdAt).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
