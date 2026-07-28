import { callAdminRpc } from '../lib/rpc';
import type { AdminTone } from '../theme/tones';

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface BroadcastSegment {
  roles?: string[];
  activity?: { orderedWithinDays?: number; notOrderedForDays?: number } | null;
  restaurantId?: string | null;
}

export interface Broadcast {
  id: string;
  title: string;
  category: 'marketing' | 'transactional';
  channels: string[];
  segment: BroadcastSegment;
  emailSubject: string | null;
  emailBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
  status: BroadcastStatus;
  scheduledAt: string | null;
  recipientCount: number;
  sentEmail: number;
  failedEmail: number;
  sentPush: number;
  failedPush: number;
  createdAt: string;
  sentAt: string | null;
}

export const broadcastTone = (status: BroadcastStatus): AdminTone => {
  switch (status) {
    case 'sent':
      return 'success';
    case 'failed':
      return 'danger';
    case 'sending':
      return 'info';
    case 'scheduled':
      return 'primary';
    case 'canceled':
      return 'neutral';
    case 'draft':
    default:
      return 'warning';
  }
};

export const listBroadcasts = () => callAdminRpc<{ broadcasts: Broadcast[] }>('broadcastList');

export const previewAudience = (segment: BroadcastSegment, category: string) =>
  callAdminRpc<{ recipientCount: number }>('broadcastPreviewAudience', { segment, category });

export const createBroadcast = (input: Record<string, unknown>) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastCreate', input);

export const scheduleBroadcast = (id: string, scheduledAt?: string) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastSchedule', { id, scheduledAt });

export const cancelBroadcast = (id: string) =>
  callAdminRpc<{ broadcast: Broadcast }>('broadcastCancel', { id });
