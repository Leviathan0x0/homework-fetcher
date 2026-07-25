import { useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { inlineErrorMessage } from "../../src/api/errors";
import type { Conversation } from "../../src/api/types";
import {
  Banner,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  ScreenHeader,
  Skeleton,
  spacing,
  useTabScreenPadding,
  useTheme,
} from "../../src/design";
import { CONVERSATION_ROW_HEIGHT, ConversationRow } from "../../src/features/messages/ConversationRow";
import { useConversationsQuery } from "../../src/features/messages/useMessages";
import { useIsOnline } from "../../src/query/appStateSync";
import { useScreenActive } from "../../src/query/useScreenActive";

/** Avatar column width, so the row separator lines up under the text. */
const AVATAR_INSET = spacing.lg + 44 + spacing.md;

/**
 * Conversation list.
 *
 * Polls every 6s, but only while this screen is focused and the app is in the
 * foreground — `useScreenActive()` returns false otherwise and TanStack Query
 * clears the interval, so switching tabs or backgrounding the app stops the
 * traffic entirely.
 */
export default function MessagesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const padding = useTabScreenPadding();
  const online = useIsOnline();
  const active = useScreenActive();

  const { data: conversations, isPending, isError, error, refetch, isRefetching } = useConversationsQuery(active);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      const other = conversation.otherUser;
      router.push({
        pathname: "/chat/[id]",
        params: {
          id: conversation.id,
          name: other?.displayName?.trim() || other?.studentId || "Chat",
        },
      });
    },
    [router],
  );

  const startNewChat = useCallback(() => router.push("/new-chat"), [router]);

  const header = (
    <ScreenHeader
      title="Messages"
      right={
        <Pressable
          onPress={startNewChat}
          hitSlop={12}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
        >
          <Icon name="newChat" size={19} color={colors.accent} weight="semibold" />
        </Pressable>
      }
    />
  );

  if (isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={{ paddingTop: padding.top }}>
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <View key={key} style={styles.skeletonRow}>
              <Skeleton width={44} height={44} radius={22} />
              <View style={styles.skeletonBody}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="75%" height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  const items = conversations ?? [];

  if (isError && items.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={{ paddingTop: padding.top, flex: 1 }}>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: padding.top, paddingBottom: padding.bottom }}
        renderItem={({ item }) => <ConversationRow conversation={item} onPress={openConversation} />}
        ItemSeparatorComponent={() => <Divider inset={AVATAR_INSET} />}
        ListHeaderComponent={
          <View>
            {!online ? (
              <Banner tone="neutral" icon="offline" message="You're offline. Showing your last saved conversations." />
            ) : null}
            {isError ? (
              <Banner
                tone="warning"
                message={`Couldn't refresh. ${inlineErrorMessage(error)}`}
                actionLabel="Retry"
                onAction={() => void refetch()}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="messages"
            title="No conversations yet"
            detail="Search for a classmate by name or student ID to start chatting."
            actionLabel="Start a chat"
            onAction={startNewChat}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !active}
            onRefresh={() => void refetch()}
            enabled={online}
            tintColor={colors.textSecondary}
            progressViewOffset={padding.top}
          />
        }
        // Rows are a fixed height, so scrolling can skip measurement entirely.
        getItemLayout={(_data, index) => ({
          length: CONVERSATION_ROW_HEIGHT,
          offset: CONVERSATION_ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={10}
        windowSize={11}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerAction: {
    width: 32,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: CONVERSATION_ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
