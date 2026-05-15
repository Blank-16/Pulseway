import https from 'node:https';

export interface DiscordPayload {
  webhookUrl: string;
  content: string;
  embeds?: unknown[];
}

export function sendDiscord(payload: DiscordPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: payload.content, embeds: payload.embeds });
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
        reject(new Error(`Discord webhook returned ${res.statusCode}`));
      } else {
        resolve();
      }
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Discord request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
