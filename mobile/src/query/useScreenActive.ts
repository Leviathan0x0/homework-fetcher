import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * True only while this screen is focused **and** the app is in the foreground.
 *
 * This is the gate for every polling interval in the app. Screen focus alone is
 * not enough — a focused screen keeps polling after the user switches apps, which
 * burns battery and data for results nobody can see. Backgrounding the app
 * therefore stops all network traffic, which is directly verifiable in a network
 * log.
 *
 * Use it as:
 *   const active = useScreenActive();
 *   useQuery({ ..., refetchInterval: active ? POLL_INTERVALS.messages : false });
 *
 * Returning `false` (rather than `undefined`) is what tells TanStack Query to
 * clear the existing timer, so nothing is left running after unmount.
 */
export function useScreenActive(): boolean {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(() => AppState.currentState === "active");

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      setForeground(status === "active");
    });
    return () => subscription.remove();
  }, []);

  return focused && foreground;
}
