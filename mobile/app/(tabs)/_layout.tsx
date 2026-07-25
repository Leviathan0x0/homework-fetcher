import { Redirect, Tabs } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { POLL_INTERVALS } from "../../src/api/config";
import { fetchUnreadCount } from "../../src/api/endpoints";
import { useAuth } from "../../src/auth/AuthProvider";
import { GlassSurface, Icon, TAB_BAR_HEIGHT, useTheme } from "../../src/design";
import { usePollInterval } from "../../src/query/appStateSync";
import { queryKeys } from "../../src/query/keys";

/**
 * Authenticated shell.
 *
 * The guard lives here so no tab screen mounts without a user — screens inside
 * this group can call `useCurrentUser()` without a null check.
 */
export default function TabsLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const badgePollInterval = usePollInterval(POLL_INTERVALS.unreadBadge, status === "signedIn");

  const { data: unreadCount = 0 } = useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: fetchUnreadCount,
    enabled: status === "signedIn",
    refetchInterval: badgePollInterval,
    // A wrong badge is worse than a slightly late one.
    staleTime: 0,
  });

  if (status !== "signedIn") {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        // Transparent + absolute so content scrolls beneath the glass.
        tabBarStyle: {
          position: "absolute",
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          borderTopWidth: 0,
          backgroundColor: "transparent",
          elevation: 0,
        },
        tabBarBackground: () => <GlassSurface intensity={80} edge="top" style={StyleSheet.absoluteFill} />,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", letterSpacing: 0 },
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.textOnAccent, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color }) => <Icon name="today" size={22} color={color} />,
          tabBarAccessibilityLabel: "Today, homework list",
        }}
      />
      <Tabs.Screen
        name="classwork"
        options={{
          title: "Classwork",
          tabBarIcon: ({ color }) => <Icon name="classwork" size={22} color={color} />,
          tabBarAccessibilityLabel: "Classwork shared with your section",
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarIcon: ({ color }) => <Icon name="requests" size={22} color={color} />,
          tabBarAccessibilityLabel: "Help requests board",
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <Icon name="messages" size={22} color={color} />,
          tabBarAccessibilityLabel: "Direct messages",
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Activity",
          tabBarIcon: ({ color }) => <Icon name="notifications" size={22} color={color} />,
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarAccessibilityLabel:
            unreadCount > 0 ? `Activity, ${unreadCount} unread` : "Activity, no unread notifications",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Icon name="settings" size={22} color={color} />,
          tabBarAccessibilityLabel: "Settings",
        }}
      />
    </Tabs>
  );
}
