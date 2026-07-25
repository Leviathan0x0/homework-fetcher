import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SEARCH_DEBOUNCE_MS } from "../../src/api/config";
import { searchUsers } from "../../src/api/endpoints";
import { inlineErrorMessage } from "../../src/api/errors";
import type { PublicUser } from "../../src/api/types";
import {
  Avatar,
  Banner,
  EmptyState,
  ErrorState,
  GlassSurface,
  Icon,
  LoadingState,
  Text,
  radii,
  spacing,
  useTheme,
} from "../../src/design";
import { MIN_TOUCH_TARGET } from "../../src/design/tokens";
import { useStartConversation } from "../../src/features/messages/useMessages";
import { useIsOnline } from "../../src/query/appStateSync";
import { queryKeys } from "../../src/query/keys";

/** Minimum characters before a request is issued. */
const MIN_QUERY_LENGTH = 1;

/**
 * New chat.
 *
 * Search is debounced by 300ms and the debounced term is the query key, so
 * TanStack Query caches per term, dedupes repeats, and cancels superseded
 * requests via the `signal` it passes through to `searchUsers`. Typing quickly
 * therefore produces one request, not one per keystroke.
 */
export default function NewChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useIsOnline();

  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [startError, setStartError] = useState<string | null>(null);

  const startConversation = useStartConversation();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const enabled = debouncedTerm.length >= MIN_QUERY_LENGTH;

  const { data: users, isFetching, isError, error, refetch } = useQuery({
    queryKey: queryKeys.userSearch(debouncedTerm),
    queryFn: ({ signal }) => searchUsers(debouncedTerm, signal),
    enabled,
    // Results barely change within a session; this keeps backtracking instant.
    staleTime: 30_000,
  });

  const openConversation = (user: PublicUser) => {
    setStartError(null);
    startConversation.mutate(user.id, {
      onSuccess: ({ conversationId }) => {
        // Replace so Back returns to the conversation list, not the search.
        router.replace({
          pathname: "/chat/[id]",
          params: { id: conversationId, name: user.displayName?.trim() || user.studentId },
        });
      },
      onError: (caught) => setStartError(inlineErrorMessage(caught)),
    });
  };

  const results = users ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <GlassSurface intensity={80} edge="bottom" style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Text variant="headline" style={styles.headerTitle}>
            New chat
          </Text>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.cancelButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text variant="callout" tone="accent">
              Cancel
            </Text>
          </Pressable>
        </View>

        <View style={[styles.searchField, { backgroundColor: colors.fill }]}>
          <Icon name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder="Name or student ID"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            maxFontSizeMultiplier={1.4}
            accessibilityLabel="Search for a classmate by name or student ID"
            style={[styles.searchInput, { color: colors.text }]}
          />
          {term.length > 0 ? (
            <Pressable
              onPress={() => setTerm("")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={15} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </GlassSurface>

      <View style={styles.body}>
        {!online ? <Banner tone="neutral" icon="offline" message="You're offline. Search needs a connection." /> : null}
        {startError ? <Banner tone="danger" message={startError} /> : null}

        {!enabled ? (
          <EmptyState
            icon="search"
            title="Find a classmate"
            detail="Start typing a name or student ID. Results appear as you type."
          />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isFetching && results.length === 0 ? (
          <LoadingState label="Searching…" />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(user) => user.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => openConversation(item)}
                disabled={startConversation.isPending}
                style={({ pressed }) => [
                  styles.resultRow,
                  { backgroundColor: pressed ? colors.surfacePressed : "transparent" },
                ]}
                accessibilityRole="button"
                // Name first, ID second — the ID is supporting detail, not the label.
                accessibilityLabel={`${item.displayName?.trim() || item.studentId}, student ID ${item.studentId}`}
                accessibilityHint="Opens a conversation with this classmate"
              >
                <Avatar id={item.id} displayName={item.displayName} studentId={item.studentId} size={40} />
                <View style={styles.resultText}>
                  <Text variant="callout" weight="600" numberOfLines={1}>
                    {item.displayName?.trim() || item.studentId}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1} tabular>
                    {item.studentId}
                    {item.section ? ` · ${item.section}` : ""}
                  </Text>
                </View>
                <Icon name="chevronRight" size={15} color={colors.textTertiary} />
              </Pressable>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="search"
                title="No matches"
                detail={`Nobody found for "${debouncedTerm}". Check the spelling, or try their student ID.`}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
  },
  headerTitle: {
    flex: 1,
  },
  cancelButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingLeft: spacing.md,
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  body: {
    flex: 1,
    paddingTop: spacing.sm,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
  },
  resultText: {
    flex: 1,
  },
});
