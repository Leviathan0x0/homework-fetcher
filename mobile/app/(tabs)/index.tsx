import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, View } from "react-native";

import { inlineErrorMessage } from "../../src/api/errors";
import type { HomeworkItem } from "../../src/api/types";
import { useCurrentUser } from "../../src/auth/AuthProvider";
import {
  Banner,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Text,
  radii,
  spacing,
  useTabScreenPadding,
  useTheme,
} from "../../src/design";
import { HomeworkRow } from "../../src/features/homework/HomeworkRow";
import { applyHomeworkFilter, collectSubjects, groupHomeworkByDate } from "../../src/features/homework/grouping";
import {
  useHomeworkQuery,
  useRefreshHomework,
  useSetHomeworkNote,
  useToggleHomeworkComplete,
} from "../../src/features/homework/useHomework";
import { useIsOnline } from "../../src/query/appStateSync";

/**
 * Today / Homework.
 *
 * Pull-to-refresh maps to `POST /api/homework/refresh`, which re-scrapes the
 * school portal and can take ~15s. That is far too long for a bare spinner, so
 * the wait gets its own explanatory banner while the standard `RefreshControl`
 * indicates activity.
 */
export default function HomeworkScreen() {
  const { colors } = useTheme();
  const user = useCurrentUser();
  const padding = useTabScreenPadding();
  const online = useIsOnline();

  const { data, isPending, isError, error, refetch } = useHomeworkQuery();
  const refresh = useRefreshHomework();
  const toggleComplete = useToggleHomeworkComplete();
  const saveNote = useSetHomeworkNote();

  const [subject, setSubject] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});

  const items = data?.items ?? [];
  const subjects = useMemo(() => collectSubjects(items), [items]);
  const sections = useMemo(
    () => groupHomeworkByDate(applyHomeworkFilter(items, { subject, hideCompleted })),
    [items, subject, hideCompleted],
  );

  const handleToggle = useCallback(
    (item: HomeworkItem, completed: boolean) => {
      toggleComplete.mutate({ id: item.id, completed });
    },
    [toggleComplete],
  );

  const handleSaveNote = useCallback(
    (item: HomeworkItem, note: string | null) => {
      saveNote.mutate(
        { id: item.id, note },
        {
          onError: (caught) => setNoteErrors((current) => ({ ...current, [item.id]: inlineErrorMessage(caught) })),
          onSuccess: () =>
            setNoteErrors((current) => {
              if (!(item.id in current)) return current;
              const next = { ...current };
              delete next[item.id];
              return next;
            }),
        },
      );
    },
    [saveNote],
  );

  const header = (
    <ScreenHeader
      title="Homework"
      subtitle={user.section ?? undefined}
      right={
        <Pressable
          onPress={() => refresh.mutate()}
          disabled={refresh.isPending || !online}
          hitSlop={12}
          style={styles.headerAction}
          accessibilityRole="button"
          accessibilityLabel="Refresh from the school portal"
          accessibilityState={{ busy: refresh.isPending, disabled: refresh.isPending || !online }}
        >
          <Icon
            name="refresh"
            size={19}
            color={refresh.isPending || !online ? colors.textTertiary : colors.accent}
            weight="semibold"
          />
        </Pressable>
      }
    />
  );

  const banners = (
    <View>
      {!online ? <Banner tone="neutral" icon="offline" message="You're offline. Showing your last saved homework." /> : null}
      {refresh.isPending ? (
        <Banner tone="info" icon="clock" message="Checking the school portal. This can take up to 15 seconds." />
      ) : null}
      {refresh.isError ? (
        <Banner
          tone="danger"
          message={inlineErrorMessage(refresh.error)}
          actionLabel="Retry"
          onAction={() => refresh.mutate()}
        />
      ) : null}
      {data?.sessionExpired ? (
        <Banner
          tone="warning"
          message="Your school session expired, so this list may be out of date. Sign out and back in to reconnect."
        />
      ) : data?.isStale && online ? (
        <Banner
          tone="warning"
          message={data.warning ?? "This list may be out of date."}
          actionLabel={refresh.isPending ? undefined : "Refresh"}
          onAction={refresh.isPending ? undefined : () => refresh.mutate()}
        />
      ) : null}
      {toggleComplete.isError ? (
        <Banner tone="danger" message={`Couldn't save that change. ${inlineErrorMessage(toggleComplete.error)}`} />
      ) : null}

      {subjects.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityRole="tablist"
        >
          <Chip label="All" selected={subject === null} onPress={() => setSubject(null)} />
          {subjects.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={subject === name}
              onPress={() => setSubject(subject === name ? null : name)}
            />
          ))}
          <Chip
            label={hideCompleted ? "Showing to-do" : "Showing all"}
            selected={hideCompleted}
            onPress={() => setHideCompleted((current) => !current)}
          />
        </ScrollView>
      ) : null}
    </View>
  );

  // First load with nothing cached: skeletons rather than a spinner, so the
  // layout does not jump when data arrives.
  if (isPending) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {header}
        <View style={{ paddingTop: padding.top, paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {[0, 1, 2, 3, 4].map((key) => (
            <View key={key} style={[styles.skeletonCard, { backgroundColor: colors.surface }]}>
              <Skeleton width="35%" height={14} />
              <Skeleton width="90%" height={12} />
              <Skeleton width="70%" height={12} />
            </View>
          ))}
        </View>
      </View>
    );
  }

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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: padding.top, paddingBottom: padding.bottom }}
        ListHeaderComponent={banners}
        renderSectionHeader={({ section }) => (
          <SectionHeader
            title={section.title}
            trailing={section.outstanding > 0 ? `${section.outstanding} to do` : "All done"}
          />
        )}
        renderItem={({ item }) => (
          <HomeworkRow
            item={item}
            onToggleComplete={handleToggle}
            onSaveNote={handleSaveNote}
            noteError={noteErrors[item.id] ?? null}
          />
        )}
        ListEmptyComponent={
          items.length === 0 ? (
            <EmptyState
              icon="today"
              title="Nothing here yet"
              detail={
                online
                  ? "No homework has been published. Pull down to check the school portal again."
                  : "You're offline and nothing is saved on this device yet."
              }
              actionLabel={online ? "Check now" : undefined}
              onAction={online ? () => refresh.mutate() : undefined}
            />
          ) : (
            <EmptyState
              icon="check"
              title="Nothing matches"
              detail="No assignments match the current filters."
              actionLabel="Clear filters"
              onAction={() => {
                setSubject(null);
                setHideCompleted(false);
              }}
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refresh.isPending}
            onRefresh={() => refresh.mutate()}
            enabled={online}
            tintColor={colors.textSecondary}
            progressViewOffset={padding.top}
          />
        }
        stickySectionHeadersEnabled
        // A tall list of glass-backed rows is cheap, but keep windowing tight so
        // scrolling stays smooth on older Android devices.
        initialNumToRender={8}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          items.length > 0 ? (
            <Text variant="caption" tone="tertiary" center style={styles.footer}>
              {items.length} assignment{items.length === 1 ? "" : "s"} saved on this device
            </Text>
          ) : null
        }
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
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  skeletonCard: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  footer: {
    paddingTop: spacing.xl,
  },
});
