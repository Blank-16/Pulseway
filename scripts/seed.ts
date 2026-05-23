#!/usr/bin/env tsx
import { loadConfig } from '@pulseway/config';
import {
  getPool, closePool,
  UserRepository, WorkspaceRepository,
  MonitorRepository, NotificationChannelRepository,
  IncidentRepository,
} from '@pulseway/db';
import bcrypt from 'bcryptjs';

const userRepo      = new UserRepository();
const workspaceRepo = new WorkspaceRepository();
const monitorRepo   = new MonitorRepository();
const channelRepo   = new NotificationChannelRepository();
const incidentRepo  = new IncidentRepository();

const MONITOR_URLS = [
  { name: 'GitHub API',        url: 'https://api.github.com',            code: 200 },
  { name: 'Cloudflare',        url: 'https://www.cloudflare.com',        code: 200 },
  { name: 'Stripe API',        url: 'https://api.stripe.com/v1',         code: 401 },
  { name: 'NPM Registry',      url: 'https://registry.npmjs.org',        code: 200 },
  { name: 'AWS S3',            url: 'https://s3.amazonaws.com',          code: 200 },
  { name: 'Google DNS',        url: 'https://dns.google',                code: 200 },
  { name: 'Cloudflare DNS',    url: 'https://cloudflare-dns.com',        code: 200 },
  { name: 'Hacker News API',   url: 'https://hacker-news.firebaseio.com', code: 200 },
  { name: 'OpenAI API',        url: 'https://api.openai.com/v1/models',  code: 401 },
  { name: 'PagerDuty API',     url: 'https://api.pagerduty.com',         code: 200 },
];

async function seed(): Promise<void> {
  await loadConfig();
  const pool = getPool();
  console.log('Seeding local database...');

  await pool.query(`
    TRUNCATE users, workspaces, workspace_members, monitors, notification_channels,
             incidents, check_results, refresh_tokens, stripe_events,
             email_verification_tokens CASCADE
  `);

  const passwordHash = await bcrypt.hash('password123', 12);

  // Primary dev workspace
  const owner = await userRepo.insert({ email: 'dev@pulseway.dev', passwordHash, name: 'Dev User' });
  await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [owner.id]);
  const ws    = await workspaceRepo.insert('Dev Workspace', 'dev-workspace');
  await workspaceRepo.addMember(owner.id, ws.id, 'owner');

  // Second member
  const member = await userRepo.insert({ email: 'member@pulseway.dev', passwordHash, name: 'Team Member' });
  await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [member.id]);
  await workspaceRepo.addMember(member.id, ws.id, 'admin');

  // 10 monitors
  const monitors = await Promise.all(
    MONITOR_URLS.map((m) => monitorRepo.insert(ws.id, {
      name                : m.name,
      url                 : m.url,
      httpMethod          : 'GET',
      requestHeaders      : {},
      expectedStatusCode  : m.code,
      checkIntervalSeconds: 60,
      regionCodes         : ['us-east-1'],
    })),
  );

  // Notification channel
  await channelRepo.insert(ws.id, 'email', { to: 'dev@pulseway.dev' });

  // Seed 30 days of synthetic check results (sparse — last result per hour)
  const now     = Date.now();
  const DAY_MS  = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  for (const mon of monitors.slice(0, 3)) {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (let h = 30 * 24; h >= 0; h--) {
      const checkedAt   = new Date(now - h * HOUR_MS);
      const isDown      = h % 97 === 0; // ~1 outage per 4 days
      const status      = isDown ? 'down' : 'up';
      const responseMs  = isDown ? 0 : 80 + Math.floor(Math.random() * 120);

      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(mon.id, status, 200, responseMs, null, checkedAt.toISOString());
    }

    await pool.query(
      `INSERT INTO check_results (monitor_id, status, status_code, response_time_ms, error_message, checked_at)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  // 5 resolved incidents with timelines
  for (let i = 0; i < 5; i++) {
    const mon       = monitors[i % monitors.length]!;
    const startedAt = new Date(now - (30 - i * 5) * DAY_MS);
    const resolvedAt = new Date(startedAt.getTime() + (i + 1) * 3600 * 1000);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO incidents (monitor_id, status, started_at, resolved_at)
       VALUES ($1, 'resolved', $2, $3) RETURNING id`,
      [mon.id, startedAt, resolvedAt],
    );
    const incidentId = rows[0]!.id;

    await pool.query(
      `INSERT INTO incident_timeline (incident_id, event_type, message, created_by)
       VALUES ($1, 'incident_opened', 'Detected after 3 consecutive failures', NULL),
              ($1, 'note_added', 'Investigating DNS propagation issues', $2),
              ($1, 'incident_resolved', 'Resolved automatically after recovery', NULL)`,
      [incidentId, owner.id],
    );
  }

  // Second workspace for isolation testing
  const owner2 = await userRepo.insert({ email: 'dev2@pulseway.dev', passwordHash, name: 'Dev 2' });
  await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [owner2.id]);
  const ws2 = await workspaceRepo.insert('Second Workspace', 'second-workspace');
  await workspaceRepo.addMember(owner2.id, ws2.id, 'owner');
  await monitorRepo.insert(ws2.id, {
    name: 'Isolated Monitor', url: 'https://example.com', httpMethod: 'GET',
    requestHeaders: {}, expectedStatusCode: 200, checkIntervalSeconds: 300, regionCodes: ['us-east-1'],
  });

  console.log('\nSeed complete:');
  console.log(`  Owner:     dev@pulseway.dev / password123`);
  console.log(`  Member:    member@pulseway.dev / password123`);
  console.log(`  Workspace: ${ws.id}`);
  console.log(`  Monitors:  ${monitors.length}`);
  console.log(`  Incidents: 5 (resolved)`);
  console.log(`\n  Second workspace owner: dev2@pulseway.dev / password123`);
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
