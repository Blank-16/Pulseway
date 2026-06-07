/**
 * Cloud-aware email sender.
 * AWS  → SES
 * Azure → Azure Communication Services Email API
 *
 * Both implementations share the same EmailPayload interface so callers
 * never need to know which provider is active.
 */
import { getConfig } from './index.js';

export interface EmailPayload {
  to      : string[];
  subject : string;
  bodyText: string;
  bodyHtml: string;
}

async function sendViaSES(payload: EmailPayload): Promise<void> {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
  const config = getConfig();
  const client = new SESClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
  await client.send(
    new SendEmailCommand({
      Source     : config.SES_FROM_ADDRESS,
      Destination: { ToAddresses: payload.to },
      Message    : {
        Subject: { Data: payload.subject,  Charset: 'UTF-8' },
        Body   : {
          Text: { Data: payload.bodyText, Charset: 'UTF-8' },
          Html: { Data: payload.bodyHtml, Charset: 'UTF-8' },
        },
      },
    }),
  );
}

async function sendViaAzureCommunicationServices(payload: EmailPayload): Promise<void> {
  const config = getConfig();

  if (!config.AZURE_EMAIL_CONNECTION_STR && !config.AZURE_EMAIL_ENDPOINT) {
    // Fallback: if no ACS configured, try SendGrid via SMTP-like approach
    // using the SENDGRID_API_KEY env var
    if (config.SENDGRID_API_KEY) {
      await sendViaSendGrid(payload, config.SENDGRID_API_KEY, config.SES_FROM_ADDRESS);
      return;
    }
    throw new Error(
      'Azure email not configured. Set AZURE_EMAIL_CONNECTION_STR or SENDGRID_API_KEY.',
    );
  }

  const { EmailClient } = await import('@azure/communication-email');

  const connStr   = config.AZURE_EMAIL_CONNECTION_STR!;
  const fromAddr  = config.SES_FROM_ADDRESS; // reuse the same env var regardless of cloud
  const client    = new EmailClient(connStr);

  const message = {
    senderAddress: fromAddr,
    recipients   : { to: payload.to.map((addr) => ({ address: addr })) },
    content      : {
      subject  : payload.subject,
      plainText: payload.bodyText,
      html     : payload.bodyHtml,
    },
  };

  const poller = await client.beginSend(message);
  await poller.pollUntilDone();
}

async function sendViaSendGrid(
  payload: EmailPayload,
  apiKey: string,
  fromAddress: string,
): Promise<void> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method : 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: payload.to.map((email) => ({ email })) }],
      from   : { email: fromAddress },
      subject: payload.subject,
      content: [
        { type: 'text/plain', value: payload.bodyText },
        { type: 'text/html',  value: payload.bodyHtml },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
}

/**
 * Cloud-aware sendEmail — routes to the correct provider based on CLOUD env var.
 * Import this everywhere instead of the provider-specific implementations.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = getConfig();
  if (config.CLOUD === 'azure') {
    return sendViaAzureCommunicationServices(payload);
  }
  return sendViaSES(payload);
}
