import https from 'node:https';
import http from 'node:http';
import { createHmac } from 'node:crypto';

export interface WebhookPayload {
  webhookUrl   : string;
  secret?      : string;
  event        : string;
  monitorName  : string;
  monitorUrl   : string;
  incidentId   : string;
  startedAt    : string;
  durationSec? : number;
}

export async function sendWebhook(payload: WebhookPayload): Promise<{ status: number }> {
  const body = JSON.stringify({
    event      : payload.event,
    monitorName: payload.monitorName,
    monitorUrl : payload.monitorUrl,
    incidentId : payload.incidentId,
    startedAt  : payload.startedAt,
    durationSec: payload.durationSec ?? null,
    timestamp  : new Date().toISOString(),
  });

  const signature = payload.secret
    ? `sha256=${createHmac('sha256', payload.secret).update(body).digest('hex')}`
    : undefined;

  return new Promise((resolve, reject) => {
    const parsed    = new URL(payload.webhookUrl);
    const isHttps   = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port    : parsed.port || undefined,
      path    : parsed.pathname + parsed.search,
      method  : 'POST',
      headers : {
        'Content-Type'      : 'application/json',
        'Content-Length'    : Buffer.byteLength(body),
        'User-Agent'        : 'Pulseway-Webhook/1.0',
        'X-Pulseway-Event'  : payload.event,
        ...(signature ? { 'X-Pulseway-Signature': signature } : {}),
      },
      timeout: 10_000,
    };

    const req = transport.request(options, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
