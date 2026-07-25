import { Redirect, Stack } from "expo-router";

import { useAuth } from "./AuthProvider";

/**
 * Stack layout for authenticated routes outside the tab bar (chat thread, new
 * chat).
 *
 * Guarding in a layout rather than inside each screen means a protected screen
 * never mounts for a frame before being redirected — which matters here because a
 * deep link (from a notification) can target these routes directly while the app
 * is signed out.
 */
export default function AuthedStack() {
  const { status } = useAuth();

  if (status !== "signedIn") {
    return <Redirect href="/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
