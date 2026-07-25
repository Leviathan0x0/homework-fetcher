import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import { ThemeProvider, useTheme } from "../src/design";
import { installAppStateSync } from "../src/query/appStateSync";
import { persistOptions } from "../src/query/persist";
import { createQueryClient } from "../src/query/queryClient";

// Keep the native splash up until the session has been resolved, so the app never
// flashes the login screen at an already-signed-in user.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);

  // Installs the AppState -> focus and NetInfo -> online bridges. This is what
  // suspends every poll while the app is backgrounded.
  useEffect(() => installAppStateSync(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Renders the navigator once the session is known.
 *
 * Access control lives in each group's layout (`(auth)/_layout`, `(tabs)/_layout`)
 * rather than here, so no protected screen mounts for a frame before being
 * redirected away.
 */
function AppShell() {
  const { status } = useAuth();
  const { colors, isDark } = useTheme();

  useEffect(() => {
    if (status !== "loading") {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === "loading") {
    // Native splash is still visible; rendering nothing avoids a white flash.
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="chat" />
        <Stack.Screen name="new-chat" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
    </View>
  );
}
