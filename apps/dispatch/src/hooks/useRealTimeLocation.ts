import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { OpenStreetMapLocationService } from '../services/osmLocation';

export interface LiveLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
}

export interface UseRealTimeLocationOptions {
  enabled?: boolean;
  updateInterval?: number;
  minAccuracy?: number;
  highAccuracy?: boolean;
}

export function useRealTimeLocation(options: UseRealTimeLocationOptions = {}) {
  const {
    enabled = true,
    updateInterval = 5000,
    minAccuracy = 50,
    highAccuracy = false,
  } = options;

  const [location, setLocation] = useState<LiveLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let mounted = true;

    const startTracking = async () => {
      try {
        const hasPermission = await OpenStreetMapLocationService.requestLocationPermission();

        if (!hasPermission) {
          if (mounted) {
            setError('Location permission denied');
            setIsTracking(false);
          }
          return;
        }

        if (mounted) {
          setIsTracking(true);
          setError(null);
        }

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: highAccuracy ? Location.Accuracy.Highest : Location.Accuracy.Balanced,
            timeInterval: updateInterval,
            distanceInterval: 5,
            mayShowUserSettingsDialog: true,
          },
          (position) => {
            const now = Date.now();

            if (position.coords.accuracy && position.coords.accuracy > minAccuracy) {
              return;
            }

            if (now - lastUpdateRef.current < updateInterval / 2) {
              return;
            }

            lastUpdateRef.current = now;

            if (mounted) {
              setLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                timestamp: now,
                accuracy: position.coords.accuracy || 0,
              });
              setError(null);
            }
          }
        );

        if (mounted) {
          subscriptionRef.current = subscription;
        }
      } catch (err) {
        console.error('Real-time location tracking error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start tracking');
          setIsTracking(false);
        }
      }
    };

    void startTracking();

    return () => {
      mounted = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      setIsTracking(false);
    };
  }, [enabled, updateInterval, minAccuracy, highAccuracy]);

  const stopTracking = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    setIsTracking(false);
    setLocation(null);
  };

  return {
    location,
    error,
    isTracking,
    stopTracking,
  };
}
