import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/auth/AuthProvider";

/**
 * Public group. Redirects away as soon as a session exists so a signed-in user
 * cannot land back on the login form (e.g. via a deep link).
 */
export default function AuthLayout() {
  const { status } = useAuth();

  if (status === "signedIn") {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: "fade" }} />;
}
