import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminCard from '../../src/components/AdminCard';
import AdminEmptyState from '../../src/components/AdminEmptyState';
import AdminScreenHeader from '../../src/components/AdminScreenHeader';
import AdminStatusBadge from '../../src/components/AdminStatusBadge';
import type { DispatchApplicationDocument, PartnerApplicationDocument, RestaurantDocument } from '../../src/domain/entities';
import { reviewDispatchApplication, reviewPartnerApplication } from '../../src/services/dispatchApplicationActions';
import { getAdminApprovalQueue } from '../../src/services/platformReads';
import { updateRestaurantApproval } from '../../src/services/restaurantApprovalActions';
import { adminTheme } from '../../src/theme/palette';
import { getApprovalTone } from '../../src/theme/status';

export default function AdminApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const [restaurants, setRestaurants] = useState<RestaurantDocument[]>([]);
  const [dispatchApplications, setDispatchApplications] = useState<DispatchApplicationDocument[]>([]);
  const [partnerApplications, setPartnerApplications] = useState<PartnerApplicationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadApprovalQueue = async () => {
      try {
        const nextData = await getAdminApprovalQueue();

        if (cancelled) {
          return;
        }

        setRestaurants(nextData.restaurants);
        setDispatchApplications(nextData.dispatchApplications);
        setPartnerApplications(nextData.partnerApplications);
        setError(null);
      } catch (nextError: any) {
        if (cancelled) {
          return;
        }

        console.error('Error loading restaurants for approvals:', nextError);
        setError(nextError.message ?? 'Unable to load restaurant approvals right now.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadApprovalQueue();
    const interval = setInterval(() => {
      void loadApprovalQueue();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const approvalQueue = useMemo(
    () =>
      [...restaurants].sort((left, right) => {
        const leftPublished = left.isPublished === true ? 1 : 0;
        const rightPublished = right.isPublished === true ? 1 : 0;

        if (leftPublished !== rightPublished) {
          return leftPublished - rightPublished;
        }

        return left.name.localeCompare(right.name);
      }),
    [restaurants]
  );

  const riderApprovalQueue = useMemo(
    () =>
      [...dispatchApplications].sort((left, right) => {
        const leftPending = left.status === 'pending' ? 0 : 1;
        const rightPending = right.status === 'pending' ? 0 : 1;

        if (leftPending !== rightPending) {
          return leftPending - rightPending;
        }

        return (left.submittedAt ?? '').localeCompare(right.submittedAt ?? '');
      }),
    [dispatchApplications]
  );

  const partnerApprovalQueue = useMemo(
    () =>
      [...partnerApplications].sort((left, right) => {
        const leftPending = left.status === 'pending' ? 0 : 1;
        const rightPending = right.status === 'pending' ? 0 : 1;

        if (leftPending !== rightPending) {
          return leftPending - rightPending;
        }

        return (left.submittedAt ?? '').localeCompare(right.submittedAt ?? '');
      }),
    [partnerApplications]
  );

  const handleRestaurantUpdate = async (
    restaurantId: string,
    updates: Partial<RestaurantDocument>,
    successMessage: string
  ) => {
    setPendingApprovalId(restaurantId);

    try {
      await updateRestaurantApproval({
        restaurantId,
        isOpen: typeof updates.isOpen === 'boolean' ? updates.isOpen : undefined,
        isPublished: typeof updates.isPublished === 'boolean' ? updates.isPublished : undefined,
      });
      Alert.alert('Update saved', successMessage);
    } catch (nextError: any) {
      Alert.alert('Update failed', nextError.message ?? 'Unable to save this restaurant change right now.');
    } finally {
      setPendingApprovalId(null);
    }
  };

  const handleDispatchApplicationReview = async (
    applicationId: string,
    decision: 'approve' | 'reject',
    rejectionReason?: string
  ) => {
    setPendingApprovalId(applicationId);

    try {
      await reviewDispatchApplication({
        applicationId,
        decision,
        rejectionReason,
      });
      Alert.alert(
        decision === 'approve' ? 'Rider approved' : 'Application rejected',
        decision === 'approve'
          ? 'The rider can now sign into the dispatch app after refreshing their session.'
          : 'The rider application has been rejected.'
      );
      const nextData = await getAdminApprovalQueue();
      setRestaurants(nextData.restaurants);
      setDispatchApplications(nextData.dispatchApplications);
      setPartnerApplications(nextData.partnerApplications);
    } catch (nextError: any) {
      Alert.alert('Review failed', nextError.message ?? 'Unable to update this rider application right now.');
    } finally {
      setPendingApprovalId(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <AdminScreenHeader
        eyebrow="Approvals"
        title="Restaurant approvals"
        subtitle="Only admins can publish customer-facing stores. Review each restaurant and keep visibility aligned with platform standards."
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <AdminCard>
          <ActivityIndicator size="large" color={adminTheme.accent} />
          <Text style={styles.loadingText}>Loading stores...</Text>
        </AdminCard>
      ) : null}

      {!loading && approvalQueue.length === 0 && riderApprovalQueue.length === 0 && partnerApprovalQueue.length === 0 ? (
        <AdminEmptyState
          title="No approvals waiting"
          body="Restaurant visibility requests, partner onboarding requests, and dispatch rider applications will show up here as operators submit them."
        />
      ) : null}

      {partnerApprovalQueue.length > 0 ? (
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Partner onboarding applications</Text>
          <Text style={styles.sectionCopy}>
            Review new restaurant partner applications before they receive partner dashboard access.
          </Text>
        </View>
      ) : null}

      {partnerApprovalQueue.map((application) => {
        const isBusy = pendingApprovalId === application.id;

        return (
          <AdminCard key={application.id}>
            <View style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.name}>{application.restaurantName}</Text>
                <Text style={styles.copy}>
                  {application.contactName} | {application.cuisine}
                </Text>
              </View>
              <AdminStatusBadge
                label={application.status}
                tone={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'}
              />
            </View>

            <Text style={styles.detailLine}>Contact email: {application.email}</Text>
            <Text style={styles.detailLine}>Phone: {application.phoneNumber}</Text>
            <Text style={styles.detailLine}>Address: {application.address}</Text>
            <Text style={styles.detailLine}>Delivery time: {application.deliveryTime ?? '25-35 min'}</Text>
            <Text style={styles.detailLine}>Description: {application.description ?? 'Not provided yet'}</Text>
            <Text style={styles.detailLine}>Submitted: {application.submittedAt}</Text>
            <Text style={styles.detailLine}>Reviewed: {application.reviewedAt ?? 'Waiting on admin review'}</Text>
            {application.rejectionReason ? (
              <Text style={styles.detailLine}>Rejection note: {application.rejectionReason}</Text>
            ) : null}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.primaryButton, application.status === 'approved' ? styles.secondaryAction : null]}
                onPress={async () => {
                  setPendingApprovalId(application.id);

                  try {
                    const result = await reviewPartnerApplication({
                      applicationId: application.id,
                      decision: 'approve',
                    });
                    Alert.alert(
                      'Partner approved',
                      `The partner can now sign in. Starter restaurant record: ${result.restaurantId ?? 'created'}.`
                    );
                    const nextData = await getAdminApprovalQueue();
                    setRestaurants(nextData.restaurants);
                    setDispatchApplications(nextData.dispatchApplications);
                    setPartnerApplications(nextData.partnerApplications);
                  } catch (nextError: any) {
                    Alert.alert('Review failed', nextError.message ?? 'Unable to approve this partner application right now.');
                  } finally {
                    setPendingApprovalId(null);
                  }
                }}
                disabled={isBusy || application.status === 'approved'}
              >
                <Text style={[styles.primaryButtonText, application.status === 'approved' ? styles.secondaryActionText : null]}>
                  {isBusy ? 'Saving...' : application.status === 'approved' ? 'Approved' : 'Approve partner'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={async () => {
                  setPendingApprovalId(application.id);

                  try {
                    await reviewPartnerApplication({
                      applicationId: application.id,
                      decision: 'reject',
                      rejectionReason: 'The restaurant onboarding details need to be corrected before approval.',
                    });
                    Alert.alert('Application rejected', 'The partner application has been rejected.');
                    const nextData = await getAdminApprovalQueue();
                    setRestaurants(nextData.restaurants);
                    setDispatchApplications(nextData.dispatchApplications);
                    setPartnerApplications(nextData.partnerApplications);
                  } catch (nextError: any) {
                    Alert.alert('Review failed', nextError.message ?? 'Unable to reject this partner application right now.');
                  } finally {
                    setPendingApprovalId(null);
                  }
                }}
                disabled={isBusy || application.status === 'rejected'}
              >
                <Text style={styles.ghostButtonText}>
                  {application.status === 'rejected' ? 'Rejected' : 'Reject application'}
                </Text>
              </TouchableOpacity>
            </View>
          </AdminCard>
        );
      })}

      {riderApprovalQueue.length > 0 ? (
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Dispatch rider applications</Text>
          <Text style={styles.sectionCopy}>
            Review rider signup requests before they receive live dispatch access.
          </Text>
        </View>
      ) : null}

      {riderApprovalQueue.map((application) => {
        const isBusy = pendingApprovalId === application.id;

        return (
          <AdminCard key={application.id}>
            <View style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.name}>{application.displayName}</Text>
                <Text style={styles.copy}>
                  {application.vehicleType} | {application.region}
                </Text>
              </View>
              <AdminStatusBadge label={application.status} tone={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'} />
            </View>

            <Text style={styles.detailLine}>Email: {application.email}</Text>
            <Text style={styles.detailLine}>Phone: {application.phoneNumber}</Text>
            <Text style={styles.detailLine}>Location: {application.latitude.toFixed(5)}, {application.longitude.toFixed(5)}</Text>
            <Text style={styles.detailLine}>Address hint: {application.currentAddress ?? 'Not provided'}</Text>
            <Text style={styles.detailLine}>Submitted: {application.submittedAt}</Text>
            <Text style={styles.detailLine}>Reviewed: {application.reviewedAt ?? 'Waiting on admin review'}</Text>
            {application.rejectionReason ? (
              <Text style={styles.detailLine}>Rejection note: {application.rejectionReason}</Text>
            ) : null}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.primaryButton, application.status === 'approved' ? styles.secondaryAction : null]}
                onPress={() => handleDispatchApplicationReview(application.id, 'approve')}
                disabled={isBusy || application.status === 'approved'}
              >
                <Text style={[styles.primaryButtonText, application.status === 'approved' ? styles.secondaryActionText : null]}>
                  {isBusy ? 'Saving...' : application.status === 'approved' ? 'Approved' : 'Approve rider'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={() =>
                  handleDispatchApplicationReview(
                    application.id,
                    'reject',
                    'The rider details need to be corrected before approval.'
                  )
                }
                disabled={isBusy || application.status === 'rejected'}
              >
                <Text style={styles.ghostButtonText}>
                  {application.status === 'rejected' ? 'Rejected' : 'Reject application'}
                </Text>
              </TouchableOpacity>
            </View>
          </AdminCard>
        );
      })}

      {approvalQueue.length > 0 ? (
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionHeading}>Restaurant approvals</Text>
          <Text style={styles.sectionCopy}>
            Publish only the stores that are ready for customers and dispatch.
          </Text>
        </View>
      ) : null}

      {approvalQueue.map((restaurant) => {
        const itemsCount = restaurant.menu?.reduce((sum, category) => sum + (category.items?.length ?? 0), 0) ?? 0;
        const isBusy = pendingApprovalId === restaurant.id;

        return (
          <AdminCard key={restaurant.id}>
            <View style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.name}>{restaurant.name}</Text>
                <Text style={styles.copy}>
                  {restaurant.cuisine ?? 'Cuisine pending'} | {restaurant.address ?? 'Address not set'}
                </Text>
              </View>
              <AdminStatusBadge
                label={restaurant.approvalStatus ?? (restaurant.isPublished === true ? 'approved' : 'pending')}
                tone={getApprovalTone(restaurant.approvalStatus, restaurant.isPublished)}
              />
            </View>

            <Text style={styles.detailLine}>Owner linked: {restaurant.ownerId ? 'Yes' : 'No'}</Text>
            <Text style={styles.detailLine}>Open now: {restaurant.isOpen === false ? 'No' : 'Yes'}</Text>
            <Text style={styles.detailLine}>Supports delivery: {restaurant.supportsDelivery === false ? 'No' : 'Yes'}</Text>
            <Text style={styles.detailLine}>Supports pickup: {restaurant.supportsPickup === false ? 'No' : 'Yes'}</Text>
            <Text style={styles.detailLine}>Menu items: {itemsCount}</Text>
            <Text style={styles.detailLine}>Restaurant ID: {restaurant.id}</Text>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.primaryButton, restaurant.isPublished === true ? styles.secondaryAction : null]}
                onPress={() =>
                  handleRestaurantUpdate(
                    restaurant.id,
                    { isPublished: restaurant.isPublished !== true },
                    restaurant.isPublished === true
                      ? 'The store was removed from customer discovery.'
                      : 'The store is now published to customers.'
                  )
                }
                disabled={isBusy}
              >
                <Text style={[styles.primaryButtonText, restaurant.isPublished === true ? styles.secondaryActionText : null]}>
                  {isBusy ? 'Saving...' : restaurant.isPublished === true ? 'Unpublish' : 'Approve & publish'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.ghostButton}
                onPress={() =>
                  handleRestaurantUpdate(
                    restaurant.id,
                    { isOpen: restaurant.isOpen === false },
                    restaurant.isOpen === false ? 'The store is marked open again.' : 'The store is now marked closed.'
                  )
                }
                disabled={isBusy}
              >
                <Text style={styles.ghostButtonText}>{restaurant.isOpen === false ? 'Reopen store' : 'Close store'}</Text>
              </TouchableOpacity>
            </View>
          </AdminCard>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  content: {
    paddingBottom: 28,
    paddingHorizontal: 18,
  },
  sectionWrap: {
    marginTop: 18,
  },
  sectionHeading: {
    color: adminTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  sectionCopy: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 13,
    marginTop: 14,
  },
  loadingText: {
    color: adminTheme.textMuted,
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  meta: {
    flex: 1,
  },
  name: {
    color: adminTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  copy: {
    color: adminTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  detailLine: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
    borderRadius: 14,
    flex: 1,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryAction: {
    backgroundColor: adminTheme.surfaceMuted,
  },
  secondaryActionText: {
    color: adminTheme.accentStrong,
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: adminTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13,
  },
  ghostButtonText: {
    color: adminTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
});
