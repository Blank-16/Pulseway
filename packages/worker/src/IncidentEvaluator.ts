import type Redis from 'ioredis';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { IncidentRepository, OnCallRepository } from '@pulseway/db';
import { ServiceBusSender, getConfig } from '@pulseway/config';
import type { MonitorStatus, SqsAlertJob } from '@pulseway/types';
import { IncidentGrouper } from './IncidentGrouper.js';
import { logger } from './logger.js';

// Single round-trip Lua: push status → trim to N → reset TTL → return list
const PUSH_AND_GET_LUA = `
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
  private readonly sqsClient           : SQSClient;
  private readonly incidentRepo        : IncidentRepository;
  private readonly onCallRepo          : OnCallRepository;
  private readonly incidentGrouper     : IncidentGrouper;
  private readonly alertQueueUrl       : string;
  private readonly consecutiveRequired : number;
  private readonly cloud               : string;
  private readonly azureAlertConnStr   : string | undefined;

  constructor(
    private readonly redisData: Redis,
    private readonly redisPub : Redis,
  ) {
    const config             = getConfig();
    this.sqsClient           = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL } as any);
    this.incidentRepo        = new IncidentRepository();
    this.onCallRepo          = new OnCallRepository();
    this.incidentGrouper     = new IncidentGrouper();
    this.alertQueueUrl       = config.ALERT_JOBS_QUEUE_URL ?? '';
    this.consecutiveRequired = config.INCIDENT_CONSECUTIVE_FAILURES_REQUIRED;
    this.cloud               = config.CLOUD;
    this.azureAlertConnStr   = config.AZURE_SERVICEBUS_ALERT_CONN_STR;
  }

  async evaluate(monitorId: string, workspaceId: string, latestStatus: MonitorStatus): Promise<void> {
    const recentKey  = `monitor:${monitorId}:recent`;
    const required   = this.consecutiveRequired;

    const recentResults = await this.redisData.eval(
      PUSH_AND_GET_LUA, 1, recentKey, latestStatus, String(required), '600',
    ) as string[];

    const [openIncident, inMaintenance] = await Promise.all([
      this.incidentRepo.findOpenByMonitorId(monitorId),
      this.onCallRepo.isInMaintenance(workspaceId, monitorId),
    ]);

    const allFailing = recentResults.length === required && recentResults.every((r) => r !== 'up');

    if (allFailing && !openIncident && !inMaintenance) {
      const incident = await this.incidentRepo.insert(monitorId);

      // Attempt grouping — non-fatal; must not block incident creation
      const groupId = await this.incidentGrouper.maybeGroup(workspaceId, incident.id).catch((err) => {
        logger.error({ err, incidentId: incident.id }, 'IncidentGrouper.maybeGroup failed');
        return null;
      });

      await this.incidentRepo.appendTimeline(
        incident.id,
        'incident_opened',
        `Detected after ${required} consecutive failures${groupId ? ` — grouped with ${groupId}` : ''}`,
        null,
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
        await this.incidentGrouper.resolveGroup(resolved.groupId).catch((err) =>
          logger.error({ err, groupId: resolved.groupId }, 'IncidentGrouper.resolveGroup failed'),
        );
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
    incidentId : string,
    monitorId  : string,
    workspaceId: string,
    eventType  : SqsAlertJob['eventType'],
  ): Promise<void> {
    const job: SqsAlertJob = { incidentId, monitorId, workspaceId, eventType, enqueuedAt: new Date().toISOString() };
    const body = JSON.stringify(job);

    if (this.cloud === 'azure') {
      if (!this.azureAlertConnStr) {
        logger.error({ incidentId }, 'AZURE_SERVICEBUS_ALERT_CONN_STR not set — alert not enqueued');
        return;
      }
      const sender = new ServiceBusSender(this.azureAlertConnStr);
      try {
        await sender.sendMessage('alert-jobs', body);
      } finally {
        await sender.close();
      }
      return;
    }

    if (!this.alertQueueUrl) {
      logger.error({ incidentId }, 'ALERT_JOBS_QUEUE_URL not set — alert not enqueued');
      return;
    }

    await this.sqsClient.send(
      new SendMessageCommand({ QueueUrl: this.alertQueueUrl, MessageBody: body }),
    );
  }
}
