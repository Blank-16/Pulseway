import https from 'node:https';

export interface SlackPayload {
  webhookUrl: string;
  text: string;
  blocks?: unknown[];
}

export function sendSlack(payload: SlackPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: payload.text, blocks: payload.blocks });
    const parsed = new URL(payload.webhookUrl);

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10_000,
    };

    const req = https.request(options, (res) => {
      res.resume();
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`Slack webhook returned ${res.statusCode}`));
      } else {
        resolve();
      }
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Slack request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
