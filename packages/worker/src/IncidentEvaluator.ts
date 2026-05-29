import type Redis from 'ioredis';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { IncidentRepository } from '@pulseway/db';
import { OnCallRepository } from '@pulseway/db';
import { IncidentGrouper } from './IncidentGrouper.js';
import { getConfig } from '@pulseway/config';
import type { MonitorStatus, SqsAlertJob } from '@pulseway/types';

// Single round-trip: push status, trim to N, reset TTL, return list — atomic
const PUSH_AND_GET = `
local key    = KEYS[1]
local status = ARGV[1]
local maxLen = tonumber(ARGV[2])
local ttl    = tonumber(ARGV[3])
redis.call('LPUSH', key, status)
redis.call('LTRIM', key, 0, maxLen - 1)
redis.call('EXPIRE', key, ttl)
return redis.call('LRANGE', key, 0, maxLen - 1)
`;

export class IncidentEvaluator {
  private readonly sqsClient: SQSClient;
  private readonly incidentRepo: IncidentRepository;
  private readonly alertQueueUrl: string;
  private readonly consecutiveRequired: number;

  constructor(
    private readonly redisData: Redis,
    private readonly redisPub: Redis,
  ) {
    const config = getConfig();
    this.sqsClient           = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
    this.incidentRepo        = new IncidentRepository();
    this.alertQueueUrl       = config.ALERT_JOBS_QUEUE_URL;
    this.consecutiveRequired = config.INCIDENT_CONSECUTIVE_FAILURES_REQUIRED;
  }

  async evaluate(monitorId: string, workspaceId: string, latestStatus: MonitorStatus): Promise<void> {
    const recentKey     = `monitor:${monitorId}:recent`;
    const required      = this.consecutiveRequired;

    const recentResults = await this.redisData.eval(
      PUSH_AND_GET, 1, recentKey, latestStatus, String(required), '600',
    ) as string[];

    const openIncident = await this.incidentRepo.findOpenByMonitorId(monitorId);
    const allFailing   = recentResults.length === required && recentResults.every((r) => r !== 'up');

    // Suppress incident creation during active maintenance windows
    const inMaintenance = await new OnCallRepository().isInMaintenance(workspaceId, monitorId);

    if (allFailing && !openIncident && !inMaintenance) {
      const incident = await this.incidentRepo.insert(monitorId);
      // Attempt to group with other concurrent incidents (infrastructure outage detection)
      await this.incidentGrouper.maybeGroup(workspaceId, incident.id).catch(() => null);
      await this.incidentRepo.appendTimeline(
        incident.id, 'incident_opened', `Detected after ${required} consecutive failures`, null,
      );
      await Promise.all([
        this.enqueueAlert(incident.id, monitorId, workspaceId, 'opened'),
        this.redisPub.publish(
          'incident-events',
          JSON.stringify({ type: 'incident:opened', data: { incidentId: incident.id, monitorId }, workspaceId }),
        ),
      ]);
      return;
    }

    if (latestStatus === 'up' && openIncident) {
      const resolved = await this.incidentRepo.resolve(openIncident.id);
      if (!resolved) return;
      if (resolved.groupId) {
        await this.incidentGrouper.resolveGroup(resolved.groupId).catch(() => null);
      }
      await this.incidentRepo.appendTimeline(
        openIncident.id, 'incident_resolved', 'Resolved automatically after recovery', null,
      );
      await Promise.all([
        this.enqueueAlert(openIncident.id, monitorId, workspaceId, 'resolved'),
        this.redisPub.publish(
          'incident-events',
          JSON.stringify({
            type: 'incident:resolved',
            data: { incidentId: openIncident.id, durationSeconds: resolved.durationSeconds ?? 0 },
            workspaceId,
          }),
        ),
      ]);
    }
  }

  private async enqueueAlert(
    incidentId: string,
    monitorId: string,
    workspaceId: string,
    eventType: SqsAlertJob['eventType'],
  ): Promise<void> {
    const job: SqsAlertJob = {
      incidentId,
      monitorId,
      workspaceId,
      eventType,
      enqueuedAt: new Date().toISOString(),
    };
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl   : this.alertQueueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  }
}
