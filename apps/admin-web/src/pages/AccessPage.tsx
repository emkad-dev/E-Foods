import { useMemo, useState, type FormEvent } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import { SkeletonRows } from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import type { AppRole, UserDocument } from '../../../../packages/domain/src';
import { canDeleteAdminAccess, canDeleteUserAccountOnRequest } from '../lib/adminOffboarding';
import { formatDateTime } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import { resolveViewState } from '../lib/viewState';
import {
  assignUserRole,
  deleteAdminAccess,
  deleteUserAccountOnRequest,
  disableUserAccess,
  enableUserAccess,
  provisionStaffAccount,
  revokeUserRole,
  updateUserRestaurantLink,
} from '../services/accessManagement';
import { getAdminAccessOverview } from '../services/platformReads';
import { getRoleTone } from '../theme/tones';

const ASSIGNABLE_ROLES: AppRole[] = ['admin', 'restaurant', 'dispatch', 'customer'];
const STAFF_ROLES = ['restaurant', 'dispatch', 'admin'] as const;

export default function AccessPage() {
  const { session } = useAuth();
  const { data, error, refresh } = usePolledRpc(getAdminAccessOverview);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AppRole>>({});
  const [restaurantDrafts, setRestaurantDrafts] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<UserDocument | null>(null);
  // Deliberately separate state from `deleteTarget`: the two deletion flows are
  // different actions with different server guards, and sharing one "target"
  // would make it possible to open one dialog and fire the other.
  const [requestDeleteTarget, setRequestDeleteTarget] = useState<UserDocument | null>(null);
  const [deletionReason, setDeletionReason] = useState('');

  const [provisionEmail, setProvisionEmail] = useState('');
  const [provisionPassword, setProvisionPassword] = useState('');
  const [provisionName, setProvisionName] = useState('');
  const [provisionRole, setProvisionRole] = useState<(typeof STAFF_ROLES)[number]>('restaurant');
  const [provisionRestaurantId, setProvisionRestaurantId] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionNotice, setProvisionNotice] = useState<string | null>(null);

  const users = useMemo(
    () => [...(data?.users ?? [])].sort((left, right) => (left.email ?? '').localeCompare(right.email ?? '')),
    [data?.users]
  );

  // The empty state was already gated on `data !== null`, but the false branch
  // of that same ternary was the table, so a failed fetch swapped one claim
  // for another: instead of "No users" the operator got a complete header row
  // with nothing under it, which says the same thing more confidently. Naming
  // 'error' as its own outcome lets the body render nothing and the banner
  // above it carry the whole message.
  const usersState = resolveViewState({
    hasData: data !== null,
    error,
    isEmpty: users.length === 0,
  });

  const runAction = async (uid: string, action: () => Promise<unknown>) => {
    setPendingUid(uid);
    setActionError(null);

    try {
      await action();
      await refresh();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'The action failed. Try again.');
    } finally {
      setPendingUid(null);
    }
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target) {
      return;
    }

    // runAction swallows the rejection into actionError, so the refusal text
    // from a 412/404 is already on screen by the time the dialog closes.
    await runAction(target.uid, () => deleteAdminAccess(target.uid));
    setDeleteTarget(null);
  };

  const handleConfirmRequestedDelete = async () => {
    const target = requestDeleteTarget;
    if (!target) {
      return;
    }

    // Same as above: runAction turns a rejection into actionError, so the
    // server's verbatim 412 — "Partner accounts linked to a restaurant must be
    // offboarded…" / "Dispatch accounts with active delivery work…" — is on
    // screen once the dialog closes, telling the operator what to clear first.
    await runAction(target.uid, () => deleteUserAccountOnRequest(target.uid, deletionReason));
    setRequestDeleteTarget(null);
    setDeletionReason('');
  };

  const handleProvision = async (event: FormEvent) => {
    event.preventDefault();
    setProvisioning(true);
    setActionError(null);
    setProvisionNotice(null);

    try {
      const result = await provisionStaffAccount({
        displayName: provisionName.trim() || undefined,
        email: provisionEmail.trim(),
        password: provisionPassword,
        role: provisionRole,
        restaurantId: provisionRestaurantId.trim() || null,
      });
      setProvisionNotice(`${result.created ? 'Created' : 'Updated'} ${result.email} as ${result.role}.`);
      setProvisionEmail('');
      setProvisionPassword('');
      setProvisionName('');
      setProvisionRestaurantId('');
      await refresh();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : 'Provisioning failed. Try again.');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="page">
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Provision staff account</h3>
        </div>
        {/* --accent-strong, not --success. The stylesheet's own comment sets the
            rule -- "the plain token fills, the -text token writes" -- and names
            --accent-strong as the one this colour writes with. On white today
            --success measures 5.13:1 and passes, so this was a latent failure
            rather than a live one: move the notice onto --success-soft, which is
            where a success message naturally lands, and it drops to 3.81:1. */}
        {provisionNotice ? (
          <p style={{ color: 'var(--accent-strong)', fontWeight: 600, marginTop: 0 }}>{provisionNotice}</p>
        ) : null}
        <form className="form-grid" onSubmit={handleProvision}>
          <div className="field">
            <label htmlFor="prov-email">Email</label>
            <input
              id="prov-email"
              type="email"
              value={provisionEmail}
              onChange={(event) => setProvisionEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="prov-password">Temporary password</label>
            <input
              id="prov-password"
              type="password"
              value={provisionPassword}
              onChange={(event) => setProvisionPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="field">
            <label htmlFor="prov-name">Display name</label>
            <input id="prov-name" value={provisionName} onChange={(event) => setProvisionName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prov-role">Role</label>
            <select
              id="prov-role"
              value={provisionRole}
              onChange={(event) => setProvisionRole(event.target.value as (typeof STAFF_ROLES)[number])}
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          {provisionRole === 'restaurant' ? (
            <div className="field">
              <label htmlFor="prov-restaurant">Restaurant ID</label>
              <input
                id="prov-restaurant"
                value={provisionRestaurantId}
                onChange={(event) => setProvisionRestaurantId(event.target.value)}
                placeholder="Optional link"
              />
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={provisioning}>
            {provisioning ? 'Provisioning…' : 'Provision account'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h3 className="card-title">Platform users</h3>
          {/* A headcount is a claim about the platform, so it waits for data
              like every other claim: ungated it read "0 accounts" through the
              whole first load and forever after a failed one. */}
          {usersState !== 'loading' && usersState !== 'error' ? (
            <span className="muted">{users.length} accounts</span>
          ) : null}
        </div>
        {/* The skeleton REPLACES the table while loading; it used to render
            above it, so a first load showed shimmer bars stacked on top of a
            fully drawn header row with nothing under it -- two loading
            metaphors at once, and an empty table that reads as "no users".
            The view state, not `!loading`, decides: usePolledRpc settles
            loading to false whether the read succeeded or threw, so !loading
            could not tell an empty platform from an unreachable one. */}
        {usersState === 'loading' ? <SkeletonRows count={6} /> : null}
        {/* "No users" was never a state this list can honestly be in: the
            admin reading it is a platform account, so they are inside the
            result set they are being told is empty. Which of the two things
            just happened is the whole value of the sentence. */}
        {usersState === 'empty' ? (
          <EmptyState
            title="No accounts came back"
            body="This list includes your own admin account, so an empty result almost certainly means the read returned nothing rather than that the platform has no users. Retry, and check the access RPC if it stays empty."
          />
        ) : null}
        {usersState === 'ready' ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Manage role</th>
                  <th>Restaurant link</th>
                  <th>Access</th>
                  {/* Its own column, not another button in "Access": deleting a
                      user account on their emailed request is a different job
                      from revoking an admin's access, and the two must never
                      look like alternatives sitting next to each other. */}
                  <th title="Honour a deletion request from an account holder who cannot use the in-app delete (feasty.com.ng/account-deletion).">
                    Deletion request
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.uid === session?.user.id;
                  const busy = pendingUid === user.uid;
                  const roleDraft = roleDrafts[user.uid] ?? (user.role as AppRole);
                  const restaurantDraft = restaurantDrafts[user.uid] ?? (user.restaurantId ?? '');
                  // Mirrors both of the server's 412 guards: admin rows only,
                  // and never the signed-in admin's own row.
                  const canDeleteAdmin = canDeleteAdminAccess({
                    role: user.role,
                    signedInUid: session?.user.id ?? null,
                    targetUid: user.uid,
                  });
                  // The mirror image: every row that is NOT an admin, and never
                  // the signed-in admin's own row. Exactly one of the two
                  // controls is ever offered, so there is nothing to choose
                  // between. The server's restaurant-linked / active-delivery
                  // 412s are NOT mirrored here — they depend on state this list
                  // does not carry, so the refusal text is surfaced instead.
                  const canDeleteOnRequest = canDeleteUserAccountOnRequest({
                    role: user.role,
                    signedInUid: session?.user.id ?? null,
                    targetUid: user.uid,
                  });

                  return (
                    <tr key={user.uid}>
                      <td>
                        <div className="cell-strong">{user.displayName || user.email}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {user.email}
                        </div>
                      </td>
                      <td>
                        <StatusBadge label={user.role} tone={getRoleTone(user.role)} />
                      </td>
                      <td>
                        {user.accountDisabled ? (
                          <span className="badge badge-danger">Disabled</span>
                        ) : (
                          <span className="badge badge-success">Active</span>
                        )}
                        {/* The overview has always returned emailVerified and
                            nothing read it, so an account that never confirmed
                            its address was indistinguishable from one that did
                            -- which matters most on the very rows an operator
                            is about to grant a staff role to. Shown only when
                            it is false; "verified" is the unremarkable case. */}
                        {user.emailVerified === false ? (
                          <span className="badge badge-warning" title="This account has never confirmed its email address.">
                            Email unverified
                          </span>
                        ) : null}
                      </td>
                      <td className="muted">{formatDateTime(user.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <select
                            className="select-pill"
                            value={roleDraft}
                            disabled={busy || isSelf}
                            onChange={(event) =>
                              setRoleDrafts((drafts) => ({ ...drafts, [user.uid]: event.target.value as AppRole }))
                            }
                          >
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy || isSelf || roleDraft === user.role}
                            onClick={() => void runAction(user.uid, () => assignUserRole(user.uid, roleDraft))}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy || isSelf || user.role === 'customer'}
                            onClick={() => void runAction(user.uid, () => revokeUserRole(user.uid))}
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                      <td>
                        {user.role === 'restaurant' ? (
                          <div className="row-actions">
                            <input
                              style={{
                                border: '1px solid var(--border-strong)',
                                borderRadius: 8,
                                padding: '6px 10px',
                                fontSize: 12,
                                width: 140,
                              }}
                              value={restaurantDraft}
                              disabled={busy}
                              placeholder="Restaurant ID"
                              onChange={(event) =>
                                setRestaurantDrafts((drafts) => ({ ...drafts, [user.uid]: event.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy || restaurantDraft === (user.restaurantId ?? '')}
                              onClick={() =>
                                void runAction(user.uid, () =>
                                  updateUserRestaurantLink(user.uid, restaurantDraft || null)
                                )
                              }
                            >
                              Save
                            </button>
                            {/* restaurantName rides along on the same record
                                and was dropped, leaving the operator to check
                                an opaque UUID against another screen before
                                daring to edit it. */}
                            {user.restaurantName ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                {user.restaurantName}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {user.accountDisabled ? (
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              disabled={busy || isSelf}
                              onClick={() => void runAction(user.uid, () => enableUserAccess(user.uid))}
                            >
                              Enable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={busy || isSelf}
                              onClick={() => void runAction(user.uid, () => disableUserAccess(user.uid))}
                            >
                              Disable
                            </button>
                          )}
                          {canDeleteAdmin ? (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={busy}
                              title="Admin offboarding: permanently deletes this admin account."
                              onClick={() => {
                                setActionError(null);
                                setDeleteTarget(user);
                              }}
                            >
                              Delete admin
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {canDeleteOnRequest ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            title="Delete this user's account because they asked us to — for someone who cannot use the in-app delete."
                            onClick={() => {
                              setActionError(null);
                              setDeletionReason('');
                              setRequestDeleteTarget(user);
                            }}
                          >
                            Delete account on request
                          </button>
                        ) : (
                          <span className="muted" title="Admin accounts are offboarded from the Access column instead.">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete this admin account?"
          body={
            <>
              <p>
                <strong>{deleteTarget.displayName || deleteTarget.email || deleteTarget.uid}</strong>
                {deleteTarget.displayName && deleteTarget.email ? ` (${deleteTarget.email})` : null} will be permanently
                deleted from the platform.
              </p>
              <p>
                UID <code>{deleteTarget.uid}</code>
              </p>
              <p>
                This cannot be undone. The account and its access are removed for good — only the offboarding audit
                entry remains. Disable access instead if you only need to lock the account out temporarily.
              </p>
            </>
          }
          busy={pendingUid === deleteTarget.uid}
          busyLabel="Deleting…"
          cancelLabel="Cancel"
          confirmLabel="Delete admin account"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}

      {requestDeleteTarget ? (
        <ConfirmDialog
          title="Delete this account on the user's request?"
          body={
            <>
              <p>
                <strong>
                  {requestDeleteTarget.displayName || requestDeleteTarget.email || requestDeleteTarget.uid}
                </strong>
                {requestDeleteTarget.displayName && requestDeleteTarget.email
                  ? ` (${requestDeleteTarget.email})`
                  : null}{' '}
                will be permanently deleted from the platform, on their behalf.
              </p>
              <p>
                UID <code>{requestDeleteTarget.uid}</code> · role <code>{requestDeleteTarget.role}</code>
              </p>
              <p>
                This cannot be undone. Only do this for an account holder who actually asked — the in-app delete is the
                normal route, and this one exists for people who cannot reach it. Confirm you are talking to the account
                owner before you continue.
              </p>
              <div className="field">
                <label htmlFor="deletion-reason">Reason (recorded in the audit log)</label>
                <textarea
                  id="deletion-reason"
                  rows={3}
                  maxLength={500}
                  value={deletionReason}
                  placeholder="e.g. emailed feastyfooders@gmail.com 2026-09-11, identity confirmed against order history"
                  onChange={(event) => setDeletionReason(event.target.value)}
                  style={{
                    border: '1px solid var(--border-strong)',
                    borderRadius: 10,
                    padding: '9px 12px',
                    font: 'inherit',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
              </div>
            </>
          }
          busy={pendingUid === requestDeleteTarget.uid}
          busyLabel="Deleting…"
          cancelLabel="Cancel"
          confirmLabel="Delete account on request"
          onCancel={() => {
            setRequestDeleteTarget(null);
            setDeletionReason('');
          }}
          onConfirm={() => void handleConfirmRequestedDelete()}
        />
      ) : null}
    </div>
  );
}
