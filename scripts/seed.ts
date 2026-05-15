#!/usr/bin/env tsx
import { loadConfig } from '@pulseway/config';
import {
  getPool,
  closePool,
  UserRepository,
  WorkspaceRepository,
  MonitorRepository,
  NotificationChannelRepository,
} from '@pulseway/db';
import bcrypt from 'bcryptjs';

const userRepo = new UserRepository();
const workspaceRepo = new WorkspaceRepository();
const monitorRepo = new MonitorRepository();
const channelRepo = new NotificationChannelRepository();

async function seed(): Promise<void> {
  await loadConfig();
  const pool = getPool();

  console.log('Seeding local database...');

  await pool.query(
    'TRUNCATE users, workspaces, workspace_members, monitors, notification_channels, incidents, check_results, refresh_tokens, stripe_events CASCADE',
  );

  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await userRepo.insert({
    email: 'dev@pulseway.dev',
    passwordHash,
    name: 'Dev User',
  });

  const workspace = await workspaceRepo.insert('Dev Workspace', 'dev-workspace');
  await workspaceRepo.addMember(user.id, workspace.id, 'owner');

  const monitors = await Promise.all([
    monitorRepo.insert(workspace.id, {
      name: 'GitHub API',
      url: 'https://api.github.com',
      httpMethod: 'GET',
      requestHeaders: { Accept: 'application/vnd.github.v3+json' },
      expectedStatusCode: 200,
      checkIntervalSeconds: 60,
      regionCodes: ['us-east-1'],
    }),
    monitorRepo.insert(workspace.id, {
      name: 'Cloudflare',
      url: 'https://www.cloudflare.com',
      httpMethod: 'HEAD',
      requestHeaders: {},
      expectedStatusCode: 200,
      checkIntervalSeconds: 60,
      regionCodes: ['us-east-1', 'eu-west-1'],
    }),
    monitorRepo.insert(workspace.id, {
      name: 'Stripe API',
      url: 'https://api.stripe.com/v1',
      httpMethod: 'GET',
      requestHeaders: {},
      expectedStatusCode: 401, // Expects 401 (auth required, not 404)
      checkIntervalSeconds: 300,
      regionCodes: ['us-east-1'],
    }),
  ]);

  await channelRepo.insert(workspace.id, 'email', { to: 'dev@pulseway.dev' });

  console.log('\nSeed complete:');
  console.log(`  User: dev@pulseway.dev / password123`);
  console.log(`  Workspace ID: ${workspace.id}`);
  console.log(`  Monitors: ${monitors.length}`);
  console.log(`\nAdd to .env: DEFAULT_WORKSPACE_ID=${workspace.id}`);
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
