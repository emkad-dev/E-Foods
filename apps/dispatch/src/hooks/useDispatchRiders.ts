import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../services/firebase/config';
import { resolveDispatchRiderCoordinate } from '../utils/dispatchRiderLocation';

export type DispatchRider = {
  activeLoadCount: number;
  activeLoad: string;
  availabilityLabel: string;
  acceptanceRate: string;
  acceptanceRateValue: number | null;
  badgeBackground: string;
  badgeColor: string;
  completedTripsCount: number;
  completedTrips: string;
  hasPreciseLocation: boolean;
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  status: string;
  vehicleType: string;
  zone: string;
};

const getTextValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const getNumberValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsedValue = Number.parseFloat(value);

      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }
  }

  return null;
};

const getBadgeForStatus = (status: string) => {
  const normalizedStatus = status.toLowerCase();

  if (normalizedStatus.includes('deliver')) {
    return {
      badgeBackground: '#dbeafe',
      badgeColor: '#1d4ed8',
    };
  }

  if (normalizedStatus.includes('delay') || normalizedStatus.includes('offline')) {
    return {
      badgeBackground: '#fee2e2',
      badgeColor: '#b91c1c',
    };
  }

  if (normalizedStatus.includes('available') || normalizedStatus.includes('idle')) {
    return {
      badgeBackground: '#dcfce7',
      badgeColor: '#166534',
    };
  }

  return {
    badgeBackground: '#e2e8f0',
    badgeColor: '#475569',
  };
};

const normalizeDispatchRider = (id: string, data: Record<string, unknown>): DispatchRider => {
  const status =
    getTextValue(data.status, data.availabilityStatus, data.currentStatus) ?? 'Available';
  const completedTrips = getNumberValue(data.completedTrips, data.completedDeliveries, data.tripsToday) ?? 0;
  const acceptanceRate = getNumberValue(data.acceptanceRate, data.acceptance, data.acceptancePercentage);
  const activeLoadCount = getNumberValue(data.activeLoad, data.currentLoad, data.activeOrders) ?? 0;
  const badge = getBadgeForStatus(status);
  const zone = getTextValue(data.zone, data.currentZone, data.baseZone, data.locationLabel) ?? 'Unassigned zone';
  const coordinate = resolveDispatchRiderCoordinate(data, zone);

  return {
    activeLoadCount,
    activeLoad: activeLoadCount === 1 ? '1 order' : `${activeLoadCount} orders`,
    availabilityLabel: status.toLowerCase(),
    acceptanceRate: acceptanceRate === null ? 'N/A' : `${acceptanceRate}%`,
    acceptanceRateValue: acceptanceRate,
    badgeBackground: badge.badgeBackground,
    badgeColor: badge.badgeColor,
    completedTripsCount: completedTrips,
    completedTrips: String(completedTrips),
    hasPreciseLocation: coordinate.isPrecise,
    id,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    name:
      getTextValue(data.displayName, data.name, data.fullName, data.riderName) ??
      `Rider ${id.slice(-4)}`,
    status,
    vehicleType: getTextValue(data.vehicleType, data.vehicle, data.transportMode) ?? 'Bike',
    zone,
  };
};

export const useDispatchRiders = () => {
  const [riders, setRiders] = useState<DispatchRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ridersQuery = query(collection(db, 'dispatchProfiles'), orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(
      ridersQuery,
      (snapshot) => {
        const nextRiders = snapshot.docs.map((docSnapshot) =>
          normalizeDispatchRider(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
        );

        setRiders(nextRiders);
        setError(null);
        setLoading(false);
      },
      (nextError) => {
        console.error('Error loading dispatch riders:', nextError);
        setRiders([]);
        setError(nextError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const onlineRiders = useMemo(
    () => riders.filter((rider) => !rider.status.toLowerCase().includes('offline')),
    [riders]
  );

  const idleRiders = useMemo(
    () =>
      onlineRiders.filter((rider) =>
        rider.availabilityLabel.includes('available') || rider.availabilityLabel.includes('idle')
      ),
    [onlineRiders]
  );

  const activeZones = useMemo(() => {
    const groupedZones = new Map<
      string,
      { activeOrders: number; idleRiders: number; riderCount: number }
    >();

    onlineRiders.forEach((rider) => {
      const currentZone = groupedZones.get(rider.zone) ?? {
        activeOrders: 0,
        idleRiders: 0,
        riderCount: 0,
      };

      currentZone.activeOrders += rider.activeLoadCount;
      currentZone.riderCount += 1;

      if (rider.availabilityLabel.includes('available') || rider.availabilityLabel.includes('idle')) {
        currentZone.idleRiders += 1;
      }

      groupedZones.set(rider.zone, currentZone);
    });

    return Array.from(groupedZones.entries()).map(([name, zone]) => {
      const pressureScore = zone.activeOrders - zone.idleRiders;
      const load =
        pressureScore >= 3 ? 'Heavy' : pressureScore >= 1 ? 'Watch' : 'Balanced';

      const tag =
        load === 'Heavy'
          ? { background: '#fee2e2', color: '#b91c1c' }
          : load === 'Watch'
            ? { background: '#fff7d6', color: '#9a6700' }
            : { background: '#dcfce7', color: '#166534' };

      return {
        activeOrders: zone.activeOrders,
        idleRiders: zone.idleRiders,
        load,
        name,
        riderCount: zone.riderCount,
        tagBackground: tag.background,
        tagColor: tag.color,
      };
    });
  }, [onlineRiders]);

  return {
    activeZones,
    error,
    idleRiders,
    loading,
    onlineRiders,
    riders,
  };
};
