import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_SIDEBAR_PREFS,
  getStoredSidebarPrefs,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  storeSidebarPrefs,
  type AdminSidebarSide,
} from '../services/session';

type SidebarPrefsContextValue = {
  ready: boolean;
  setSide: (side: AdminSidebarSide) => void;
  setWidth: (width: number) => void;
  side: AdminSidebarSide;
  width: number;
};

const clampWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

const SidebarPrefsContext = createContext<SidebarPrefsContextValue | undefined>(undefined);

export const AdminSidebarPrefsProvider = ({ children }: { children: ReactNode }) => {
  const [side, setSideState] = useState<AdminSidebarSide>(DEFAULT_SIDEBAR_PREFS.side);
  const [width, setWidthState] = useState<number>(DEFAULT_SIDEBAR_PREFS.width);
  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await getStoredSidebarPrefs();

      if (cancelled) {
        return;
      }

      setSideState(stored.side);
      setWidthState(stored.width);
      hydratedRef.current = true;
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    void storeSidebarPrefs({ side, width });
  }, [side, width]);

  const setSide = (next: AdminSidebarSide) => setSideState(next);
  const setWidth = (next: number) => setWidthState(clampWidth(next));

  const value = useMemo<SidebarPrefsContextValue>(
    () => ({ ready, setSide, setWidth, side, width }),
    [ready, side, width]
  );

  return <SidebarPrefsContext.Provider value={value}>{children}</SidebarPrefsContext.Provider>;
};

export const useSidebarPrefs = (): SidebarPrefsContextValue => {
  const context = useContext(SidebarPrefsContext);

  if (!context) {
    throw new Error('useSidebarPrefs must be used within AdminSidebarPrefsProvider');
  }

  return context;
};
