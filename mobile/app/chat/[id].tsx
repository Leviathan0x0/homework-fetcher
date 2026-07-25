import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { fetchConversations } from "../../src/api/endpoints";
import { describeApiError, inlineErrorMessage, isApiError } from "../../src/api/errors";
import type { Conversation, LocalFile } from "../../src/api/types";
import {
  Banner,
  EmptyState,
  ErrorState,
  ImageLightbox,
  ScreenHeader,
  Skeleton,
  spacing,
  useTheme,
} from "../../src/design";
import { HEADER_HEIGHT } from "../../src/design/layout";
import { AttachmentSourceSheet } from "../../src/features/media/AttachmentSourceSheet";
import { PermissionDeniedError, pickAttachment, type PickSource } from "../../src/features/media/pickAttachment";
import { ChatBubble, ChatDateSeparator } from "../../src/features/messages/ChatBubble";
import { Composer } from "../../src/features/messages/Composer";
import { buildChatRows, type ChatRow } from "../../src/features/messages/timeline";
import {
  useMarkConversationRead,
  useMessagesQuery,
  useOutbox,
} from "../../src/features/messages/useMessages";
import { useIsOnline } from "../../src/query/appStateSync";
import { queryKeys } from "../../src/query/keys";
import { useScreenActive } from "../../src/query/useScreenActive";

/**
 * Chat thread.
 *
 * The moving parts, and why they are arranged this way:
 *  - **Inverted FlatList.** Newest at the bottom without manual scrolling, and new
 *    messages arriving from the 3s poll do not shift what you are reading.
 *  - **Outbox, not an optimistic cache write.** A poll landing mid-send would
 *    overwrite an optimistic cache entry and make the bubble flicker. The outbox
 *    lives beside the query and is merged at render time instead.
 *  - **Mark read is keyed to the newest incoming message id**, so it fires on open
 *    and when new messages arrive — but not on every 3s tick.
 */
export default function ChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const active = useScreenActive();

  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const conversationId = params.id;

  const { data: messages, isPending, isError, error, refetch } = useMessagesQuery(conversationId, active);
  const outbox = useOutbox(conversationId);
  const markRead = useMarkConversationRead();

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<LocalFile | null>(null);
  const [sourceSheetVisible, setSourceSheetVisible] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ path: string; title: string | null } | null>(null);

  // Prefer the live conversation record for the header so a rename shows up, and
  // fall back to the name passed in the route for an instant first paint.
  //
  // `enabled: false` reads the cache and re-renders when it changes, without
  // issuing a request — reading via `getQueryData` during render would not be
  // reactive.
  const { data: conversations } = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: fetchConversations,
    enabled: false,
  });
  const conversation = conversations?.find((item: Conversation) => item.id === conversationId);
  const otherName =
    conversation?.otherUser?.displayName?.trim() ||
    conversation?.otherUser?.studentId ||
    params.name ||
    "Chat";
  const otherSection = conversation?.otherUser?.section ?? undefined;

  const rows = useMemo(
    () => buildChatRows(conversationId, messages ?? [], outbox.items),
    [conversationId, messages, outbox.items],
  );

  /* ---------------------------------------------------------------------- */
  /* Mark read                                                              */
  /* ---------------------------------------------------------------------- */

  const lastMarkedRef = useRef<string | null>(null);
  const newestIncomingId = useMemo(() => {
    const incoming = (messages ?? []).filter((message) => !message.isMine);
    return incoming.length > 0 ? (incoming[incoming.length - 1]?.id ?? null) : null;
  }, [messages]);

  useEffect(() => {
    if (!active || !newestIncomingId) return;
    if (lastMarkedRef.current === newestIncomingId) return;
    lastMarkedRef.current = newestIncomingId;
    markRead.mutate(conversationId);
    // `markRead` is a stable mutation object; including it would re-run this on
    // every status change and re-mark repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, newestIncomingId, conversationId]);

  /* ---------------------------------------------------------------------- */
  /* Attachments                                                            */
  /* ---------------------------------------------------------------------- */

  const handlePick = useCallback(async (source: PickSource) => {
    setAttachError(null);
    setPreparing(true);
    try {
      const picked = await pickAttachment(source);
      if (picked) {
        setAttachment(picked);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (caught) {
      if (caught instanceof PermissionDeniedError) {
        setAttachError(caught.message);
      } else {
        setAttachError(inlineErrorMessage(caught));
      }
    } finally {
      setPreparing(false);
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Send                                                                   */
  /* ---------------------------------------------------------------------- */

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (!content && !attachment) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    outbox.enqueue(content, attachment);
    // Cleared only after the outbox has taken ownership of the content, so the
    // text is never in neither place.
    setDraft("");
    setAttachment(null);
    setAttachError(null);
  }, [attachment, draft, outbox]);

  const handleDiscard = useCallback(
    (localId: string) => {
      const discarded = outbox.discard(localId);
      if (!discarded) return;
      // Put the text back so a failed send is editable rather than lost.
      setDraft((current) => (current.length > 0 ? current : discarded.content));
      if (discarded.file) setAttachment(discarded.file);
    },
    [outbox],
  );

  /* ---------------------------------------------------------------------- */
  /* Composer notice                                                        */
  /* ---------------------------------------------------------------------- */

  const rateLimited = outbox.items.find(
    (item) => item.status === "failed" && isApiError(item.error) && item.error.kind === "rateLimited",
  );

  const composerNotice = attachError
    ? ({ tone: "danger", message: attachError } as const)
    : rateLimited
      ? ({ tone: "warning", message: describeApiError(rateLimited.error).detail } as const)
      : !online
        ? ({ tone: "warning", message: "You're offline. Messages will fail to send until you reconnect." } as const)
        : null;

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) =>
      item.kind === "separator" ? (
        <ChatDateSeparator label={item.label} />
      ) : (
        <ChatBubble row={item} onOpenImage={(path, title) => setLightbox({ path, title })} onRetry={outbox.retry} onDiscard={handleDiscard} />
      ),
    [handleDiscard, outbox.retry],
  );

  const listTopPadding = insets.top + HEADER_HEIGHT + spacing.md;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title={otherName} subtitle={otherSection} showBack />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The composer sits above the keyboard; on Android the window resizes.
        keyboardVerticalOffset={0}
      >
        {isPending ? (
          <View style={[styles.flex, { paddingTop: listTopPadding, paddingHorizontal: spacing.lg, gap: spacing.md }]}>
            {[0, 1, 2, 3].map((key) => (
              <View key={key} style={key % 2 === 0 ? styles.skeletonLeft : styles.skeletonRight}>
                <Skeleton width={key % 2 === 0 ? 200 : 150} height={44} radius={14} />
              </View>
            ))}
          </View>
        ) : isError && (messages ?? []).length === 0 ? (
          <View style={[styles.flex, { paddingTop: listTopPadding }]}>
            <ErrorState error={error} onRetry={() => void refetch()} />
          </View>
        ) : (
          <FlatList
            data={rows}
            inverted
            keyExtractor={(row) => row.id}
            renderItem={renderRow}
            // Inverted: this padding lands at the visual bottom, above the composer.
            contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: listTopPadding }}
            style={styles.flex}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={15}
            windowSize={11}
            removeClippedSubviews={Platform.OS === "android"}
            ListFooterComponent={
              // Inverted, so this renders at the very top of the thread.
              rows.length > 0 ? <View style={{ height: spacing.sm }} /> : null
            }
            ListEmptyComponent={
              <View style={{ paddingTop: listTopPadding }}>
                <EmptyState
                  icon="messages"
                  title={`Say hello to ${otherName}`}
                  detail="Messages you send here are private between the two of you."
                />
              </View>
            }
          />
        )}

        {isError && (messages ?? []).length > 0 ? (
          <Banner
            tone="warning"
            message={`Couldn't refresh messages. ${inlineErrorMessage(error)}`}
            actionLabel="Retry"
            onAction={() => void refetch()}
          />
        ) : null}

        <Composer
          value={draft}
          onChangeText={setDraft}
          attachment={attachment}
          onRequestAttachment={() => setSourceSheetVisible(true)}
          onClearAttachment={() => setAttachment(null)}
          onSend={handleSend}
          preparing={preparing}
          notice={composerNotice}
        />
      </KeyboardAvoidingView>

      <AttachmentSourceSheet
        visible={sourceSheetVisible}
        onClose={() => setSourceSheetVisible(false)}
        onPick={(source) => void handlePick(source)}
      />

      <ImageLightbox
        visible={lightbox !== null}
        path={lightbox?.path ?? null}
        title={lightbox?.title ?? null}
        onClose={() => setLightbox(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  skeletonLeft: {
    alignItems: "flex-start",
  },
  skeletonRight: {
    alignItems: "flex-end",
  },
});
