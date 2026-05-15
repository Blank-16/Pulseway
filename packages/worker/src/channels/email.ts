import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getConfig } from '@pulseway/config';

let client: SESClient | null = null;
function getSES(): SESClient {
  if (!client) {
    const config = getConfig();
    client = new SESClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
  }
  return client;
}

export interface EmailPayload {
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = getConfig();
  await getSES().send(
    new SendEmailCommand({
      Source: config.SES_FROM_ADDRESS,
      Destination: { ToAddresses: payload.to },
      Message: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: payload.bodyText, Charset: 'UTF-8' },
          Html: { Data: payload.bodyHtml, Charset: 'UTF-8' },
        },
      },
    }),
  );
}
