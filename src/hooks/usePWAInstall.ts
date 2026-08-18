import { useSyncExternalStore } from 'react';
import {
  getPWAInstallSnapshot,
  getServerPWAInstallSnapshot,
  requestPWAInstall,
  subscribeToPWAInstall,
} from '../services/pwaInstall';

export function usePWAInstall() {
  const snapshot = useSyncExternalStore(
    subscribeToPWAInstall,
    getPWAInstallSnapshot,
    getServerPWAInstallSnapshot,
  );

  return { ...snapshot, install: requestPWAInstall };
}
