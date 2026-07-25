import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { POLL_INTERVALS } from "../../api/config";
import {
  createConversation,
  fetchConversations,
  fetchMessages,
  markConversationRead,
  sendMessage,
} from "../../api/endpoints";
import type { Conversation, LocalFile, Message } from "../../api/types";
import { queryKeys } from "../../query/keys";

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Conversation list.
 *
 * `active` comes from `useScreenActive()`; passing `false` clears the interval, so
 * the inbox stops polling the moment the screen loses focus or the app is
 * backgrounded.
 */
export function useConversationsQuery(active: boolean) {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: fetchConversations,
    refetchInterval: active ? POLL_INTERVALS.inbox : false,
    // Short, because unread counts and previews go stale quickly, but non-zero so
    // returning to the tab does not always cause a visible reload.
    staleTime: 5_000,
  });
}

/** Messages in one thread. Polls every 3s while the chat is open and foregrounded. */
export function useMessagesQuery(conversationId: string, active: boolean) {
  return useQuery({
    queryKey: queryKeys.messages(conversationId),
    queryFn: () => fetchMessages(conversationId),
    refetchInterval: active ? POLL_INTERVALS.messages : false,
    staleTime: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Mark read                                                                   */
/* -------------------------------------------------------------------------- */

interface MarkReadContext {
  conversations: Conversation[] | undefined;
  unread: number | undefined;
}

/**
 * Marks a conversation read, optimistically.
 *
 * Both the conversation row's badge and the tab bar's total are adjusted straight
 * away — leaving the tab badge stale for up to 20s after opening a chat is the
 * kind of small wrongness that makes an app feel unreliable.
 */
export function useMarkConversationRead(): UseMutationResult<void, unknown, string, MarkReadContext> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) => markConversationRead(conversationId),
    onMutate: async (conversationId) => {
      const conversations = queryClient.getQueryData<Conversation[]>(queryKeys.conversations);
      const unread = queryClient.getQueryData<number>(queryKeys.unreadCount);

      const clearing = conversations?.find((item) => item.id === conversationId)?.unreadCount ?? 0;

      if (conversations) {
        queryClient.setQueryData<Conversation[]>(
          queryKeys.conversations,
          conversations.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item)),
        );
      }
      if (typeof unread === "number" && clearing > 0) {
        queryClient.setQueryData<number>(queryKeys.unreadCount, Math.max(0, unread - clearing));
      }

      return { conversations, unread };
    },
    onError: (_error, _conversationId, context) => {
      if (context?.conversations) {
        queryClient.setQueryData(queryKeys.conversations, context.conversations);
      }
      if (typeof context?.unread === "number") {
        queryClient.setQueryData(queryKeys.unreadCount, context.unread);
      }
    },
    onSuccess: () => {
      // The server also clears the matching `new_message` notifications, so the
      // notification list is now out of date.
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                      */
/* -------------------------------------------------------------------------- */

export type OutboxStatus = "sending" | "failed";

export interface OutboxItem {
  /** Client-generated id, stable across retries. */
  localId: string;
  content: string;
  file: LocalFile | null;
  status: OutboxStatus;
  /** Populated when `status` is `failed`. */
  error: unknown;
  createdAt: string;
}

export interface Outbox {
  items: OutboxItem[];
  /** Queues a message and starts sending. */
  enqueue: (content: string, file: LocalFile | null) => void;
  /** Re-sends a failed item. */
  retry: (localId: string) => void;
  /**
   * Removes a failed item and returns its content so the composer can restore the
   * draft — a discarded message must never vanish silently.
   */
  discard: (localId: string) => OutboxItem | undefined;
}

let outboxCounter = 0;
function nextLocalId(): string {
  outboxCounter += 1;
  return `outbox-${Date.now()}-${outboxCounter}`;
}

/**
 * Pending outgoing messages for one conversation.
 *
 * Deliberately *not* a TanStack optimistic cache write: the 3s poll would
 * overwrite an optimistic entry the moment it refetched, making the bubble flicker
 * out and back. Keeping the outbox beside the query and merging at render time is
 * both simpler and immune to that race.
 *
 * A failed item stays in the outbox with its content and file intact, so retry is
 * a genuine re-send rather than asking the user to retype.
 */
export function useOutbox(conversationId: string): Outbox {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<OutboxItem[]>([]);
  // Kept in a ref so `retry` can read current items without re-creating callbacks.
  const itemsRef = useRef<OutboxItem[]>([]);
  itemsRef.current = items;

  const patch = useCallback((localId: string, changes: Partial<OutboxItem>) => {
    setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...changes } : item)));
  }, []);

  const dispatchSend = useCallback(
    async (item: OutboxItem) => {
      patch(item.localId, { status: "sending", error: null });
      try {
        const saved = await sendMessage({
          conversationId,
          content: item.content || undefined,
          file: item.file ?? undefined,
        });

        // Append the confirmed message so the bubble is replaced in the same frame
        // the outbox entry is dropped — no gap, no flicker.
        queryClient.setQueryData<Message[]>(queryKeys.messages(conversationId), (current) => {
          if (!current) return [saved];
          return current.some((message) => message.id === saved.id) ? current : [...current, saved];
        });
        setItems((current) => current.filter((existing) => existing.localId !== item.localId));

        // The list preview and ordering changed.
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      } catch (error) {
        patch(item.localId, { status: "failed", error });
      }
    },
    [conversationId, patch, queryClient],
  );

  const enqueue = useCallback(
    (content: string, file: LocalFile | null) => {
      const item: OutboxItem = {
        localId: nextLocalId(),
        content,
        file,
        status: "sending",
        error: null,
        createdAt: new Date().toISOString(),
      };
      setItems((current) => [...current, item]);
      void dispatchSend(item);
    },
    [dispatchSend],
  );

  const retry = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((existing) => existing.localId === localId);
      if (item) void dispatchSend(item);
    },
    [dispatchSend],
  );

  const discard = useCallback((localId: string) => {
    const item = itemsRef.current.find((existing) => existing.localId === localId);
    setItems((current) => current.filter((existing) => existing.localId !== localId));
    return item;
  }, []);

  return useMemo(() => ({ items, enqueue, retry, discard }), [items, enqueue, retry, discard]);
}

/* -------------------------------------------------------------------------- */
/* Starting a conversation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates or reuses a conversation with another student.
 *
 * The server returns the existing conversation when one already exists, so this is
 * safe to call from a search result without checking first.
 */
export function useStartConversation(): UseMutationResult<
  { conversationId: string },
  unknown,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (participantId: string) => createConversation(participantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
}
