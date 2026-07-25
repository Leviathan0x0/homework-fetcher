import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { setNetworkProbe } from "../api/client";

let installed = false;

/**
 * Wires TanStack Query to the two pieces of platform state it needs.
 *
 * `focusManager` is the mechanism that satisfies "pause ALL polling when
 * backgrounded": with `refetchIntervalInBackground: false`, an unfocused client
 * stops every interval at once, and resuming focus refetches stale queries. Doing
 * it here rather than per-screen means a new polled query cannot forget to
 * opt in.
 *
 * `onlineManager` pauses queries while offline instead of letting each one fail,
 * and triggers a refetch on reconnect.
 *
 * Safe to call more than once; only the first call installs listeners.
 */
export function installAppStateSync(): () => void {
  if (installed) return () => undefined;
  installed = true;

  const appStateSubscription = AppState.addEventListener("change", (status: AppStateStatus) => {
    focusManager.setFocused(status === "active");
  });
  focusManager.setFocused(AppState.currentState === "active");

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // `isInternetReachable` is null while probing; treat unknown as online so a
      // slow probe does not lock the app into an offline state.
      const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(online);
    }),
  );

  // Lets the API client distinguish "no connection" from "server not answering".
  setNetworkProbe(() => onlineManager.isOnline());

  return () => {
    appStateSubscription.remove();
    onlineManager.setEventListener(() => undefined);
    setNetworkProbe(() => null);
    installed = false;
  };
}

/** Subscribes to online state for banners. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}

/** True while the app is in the foreground. */
export function useIsForeground(): boolean {
  const [foreground, setForeground] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setForeground(status === "active"));
    return () => subscription.remove();
  }, []);
  return foreground;
}

/**
 * Poll interval for a query, or `false` to stop polling.
 *
 * Returns `false` when the app is backgrounded or offline. `focusManager` already
 * handles the background case inside TanStack Query; this makes the intent
 * explicit at the call site and covers the offline case too.
 */
export function usePollInterval(intervalMs: number, enabled = true): number | false {
  const foreground = useIsForeground();
  const online = useIsOnline();
  return enabled && foreground && online ? intervalMs : false;
}
