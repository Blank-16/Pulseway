// Cloud-aware email — implementation lives in @pulseway/config
// so it works on both AWS (SES) and Azure (ACS / SendGrid).
export { sendEmail } from '@pulseway/config';
export type { EmailPayload } from '@pulseway/config';
