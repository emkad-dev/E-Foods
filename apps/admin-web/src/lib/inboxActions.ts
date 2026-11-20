import type { SupportStatus } from '../services/supportInbox';

export interface InboxStatusAction {
  status: SupportStatus;
  label: string;
}

const STATUS_ACTIONS: InboxStatusAction[] = [
  { status: 'pending', label: 'Mark waiting on customer' },
  { status: 'closed', label: 'Close' },
  { status: 'open', label: 'Reopen' },
];

/**
 * The status buttons worth offering for a conversation: every status except
 * the one it already has. "Reopen" on an open conversation was a button that
 * did nothing visible, which read as a broken console.
 */
export const statusActionsFor = (current: SupportStatus): InboxStatusAction[] =>
  STATUS_ACTIONS.filter((action) => action.status !== current);
