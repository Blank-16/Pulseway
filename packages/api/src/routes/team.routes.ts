import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate-body.js';
import { handler, authHandler } from '../middleware/handler.js';
import { WorkspaceRepository, NotificationChannelRepository, UserRepository } from '@pulseway/db';
import { AppError } from '../errors.js';
import { invalidateMembershipCache } from '../services/MembershipCache.js';
import type { MemberRole, NotificationChannelType } from '@pulseway/types';

const InviteSchema = z.object({ email: z.string().email(), role: z.enum(['admin', 'viewer']) });
const UpdateRoleSchema = z.object({ role: z.enum(['admin', 'viewer']) });
const ChannelSchema = z.object({
  channelType: z.enum(['email', 'slack', 'discord', 'webhook']),
  config: z.record(z.string(), z.string()),
  isActive: z.boolean().default(true),
});

const workspaceRepo = new WorkspaceRepository();
const channelRepo = new NotificationChannelRepository();
const userRepo = new UserRepository();

export function teamRoutes(): Router {
  const router = Router();
  router.use(handler(authenticate));

  router.get('/workspaces', authHandler(async (req: any, res) => {
    const workspaces = await workspaceRepo.findUserWorkspaces(req.user.id);
    res.json({ data: workspaces });
  }));

  router.get('/workspace/:workspaceId/members',
    authHandler(authorize('viewer')),
    authHandler(async (req: any, res) => {
      res.json({ data: await workspaceRepo.listMembers(req.params['workspaceId']!) });
    }),
  );

  router.post('/workspace/:workspaceId/members',
    authHandler(authorize('admin')),
    handler(validateBody(InviteSchema)),
    authHandler(async (req: any, res) => {
      const user = await userRepo.findByEmail(req.body.email);
      if (!user) throw AppError.notFound('No user found with that email');
      await workspaceRepo.addMember(user.id, req.params['workspaceId']!, req.body.role as MemberRole);
      await invalidateMembershipCache(user.id, req.params['workspaceId']!);
      res.status(201).json({ data: { ok: true } });
    }),
  );

  router.patch('/workspace/:workspaceId/members/:userId',
    authHandler(authorize('admin')),
    handler(validateBody(UpdateRoleSchema)),
    authHandler(async (req: any, res) => {
      if (req.params['userId'] === req.user.id) throw AppError.badRequest('Cannot change your own role');
      await workspaceRepo.addMember(req.params['userId']!, req.params['workspaceId']!, req.body.role as MemberRole);
      await invalidateMembershipCache(req.params['userId']!, req.params['workspaceId']!);
      res.json({ data: { ok: true } });
    }),
  );

  router.delete('/workspace/:workspaceId/members/:userId',
    authHandler(authorize('owner')),
    authHandler(async (req: any, res) => {
      if (req.params['userId'] === req.user.id) throw AppError.badRequest('Cannot remove yourself');
      await workspaceRepo.removeMember(req.params['userId']!, req.params['workspaceId']!);
      await invalidateMembershipCache(req.params['userId']!, req.params['workspaceId']!);
      res.status(204).end();
    }),
  );

  router.get('/workspace/:workspaceId/channels',
    authHandler(authorize('admin')),
    authHandler(async (req: any, res) => {
      res.json({ data: await channelRepo.findByWorkspace(req.params['workspaceId']!) });
    }),
  );

  router.post('/workspace/:workspaceId/channels',
    authHandler(authorize('admin')),
    handler(validateBody(ChannelSchema)),
    authHandler(async (req: any, res) => {
      const channel = await channelRepo.insert(req.params['workspaceId']!, req.body.channelType as NotificationChannelType, req.body.config);
      res.status(201).json({ data: channel });
    }),
  );

  router.patch('/workspace/:workspaceId/channels/:channelId',
    authHandler(authorize('admin')),
    handler(validateBody(ChannelSchema.partial())),
    authHandler(async (req: any, res) => {
      const channel = await channelRepo.update(req.params['channelId']!, req.body.config ?? {}, req.body.isActive ?? true);
      if (!channel) throw AppError.notFound('Channel not found');
      res.json({ data: channel });
    }),
  );

  router.delete('/workspace/:workspaceId/channels/:channelId',
    authHandler(authorize('admin')),
    authHandler(async (req: any, res) => {
      await channelRepo.delete(req.params['channelId']!);
      res.status(204).end();
    }),
  );

  return router;
}
