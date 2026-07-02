import { useMemo, useState, type FormEvent } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import type { AppRole } from '../../../../packages/domain/src';
import { formatDateTime } from '../lib/format';
import { usePolledRpc } from '../lib/usePolledRpc';
import {
  assignUserRole,
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
  const { data, loading, error, refresh } = usePolledRpc(getAdminAccessOverview);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AppRole>>({});
  const [restaurantDrafts, setRestaurantDrafts] = useState<Record<string, string>>({});

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
        {provisionNotice ? (
          <p style={{ color: 'var(--success)', fontWeight: 600, marginTop: 0 }}>{provisionNotice}</p>
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
          <span className="muted">{users.length} accounts</span>
        </div>
        {loading ? <LoadingBlock label="Loading users…" /> : null}
        {!loading && users.length === 0 ? (
          <EmptyState title="No users" body="Platform accounts will appear here." />
        ) : (
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
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.uid === session?.user.id;
                  const busy = pendingUid === user.uid;
                  const roleDraft = roleDrafts[user.uid] ?? (user.role as AppRole);
                  const restaurantDraft = restaurantDrafts[user.uid] ?? (user.restaurantId ?? '');

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
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
