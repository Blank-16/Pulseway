export type WorkspacePlan = 'free' | 'pro' | 'team';
export type MemberRole = 'owner' | 'admin' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: WorkspacePlan;
  stripeCustomerId: string | null;
  stripeSubId: string | null;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  workspaceId: string;
  role: MemberRole;
  joinedAt: string;
  user?: Pick<User, 'id' | 'email' | 'name'>;
}

export type NotificationChannelType = 'email' | 'slack' | 'discord';

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  channelType: NotificationChannelType;
  config: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}
