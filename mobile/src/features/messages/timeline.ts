import type { Message } from "../../api/types";
import { formatDateHeading, toCalendarDate } from "../../utils/datetime";
import type { OutboxItem } from "./useMessages";

/**
 * Turns confirmed messages plus the outbox into a flat, keyed row list for an
 * inverted FlatList.
 *
 * Doing this as a pure function keeps the chat screen free of grouping logic and
 * makes the tricky parts — day boundaries, sender runs, pending bubbles — cheap to
 * reason about.
 */

export interface MessageRow {
  kind: "message";
  id: string;
  message: Message;
  /** Set while the message is still pending or has failed to send. */
  outbox: OutboxItem | null;
  /** Show the sender's name: incoming, and first of a same-sender run. */
  showSender: boolean;
  /** Last of a run — carries the timestamp so a burst is not repeated per bubble. */
  showTime: boolean;
  /** Internal grouping key: "me" or the sender id. */
  senderKey: string;
}

export interface SeparatorRow {
  kind: "separator";
  id: string;
  label: string;
}

export type ChatRow = MessageRow | SeparatorRow;

/** A run is broken when this much time passes, so a later reply gets its own stamp. */
const RUN_GAP_MS = 5 * 60 * 1000;

/**
 * Synthesises a `Message` for a pending outbox entry.
 *
 * `attachmentUrl` stays null on purpose: an outbox attachment is a *local* file
 * URI, and passing it to `AuthedImage` (which prefixes the API base URL and adds
 * an auth header) would fail. The bubble reads `row.outbox.file` for the local
 * preview instead.
 */
function outboxToMessage(item: OutboxItem, conversationId: string): Message {
  return {
    id: item.localId,
    conversationId,
    senderId: "me",
    senderStudentId: "",
    senderName: null,
    content: item.content,
    attachmentUrl: null,
    originalFilename: item.file?.name ?? null,
    mimeType: item.file?.type ?? null,
    createdAt: item.createdAt,
    isMine: true,
  };
}

export function buildChatRows(
  conversationId: string,
  messages: Message[],
  outbox: OutboxItem[],
): ChatRow[] {
  const chronological: { message: Message; outbox: OutboxItem | null }[] = [
    ...messages.map((message) => ({ message, outbox: null })),
    ...outbox.map((item) => ({ message: outboxToMessage(item, conversationId), outbox: item })),
  ];

  const rows: ChatRow[] = [];
  let previousDate: string | null = null;
  let previousSenderKey: string | null = null;
  let previousTimestamp = 0;

  for (const entry of chronological) {
    const { message } = entry;
    const date = toCalendarDate(message.createdAt);
    const timestamp = Date.parse(message.createdAt) || 0;

    if (date !== previousDate) {
      rows.push({ kind: "separator", id: `separator-${date}`, label: formatDateHeading(date) });
      previousDate = date;
      // A new day always starts a fresh run.
      previousSenderKey = null;
    }

    // Trust the server's `isMine`; never compare sender ids on the client.
    const senderKey = message.isMine ? "me" : message.senderId;
    const continuesRun = senderKey === previousSenderKey && timestamp - previousTimestamp < RUN_GAP_MS;

    rows.push({
      kind: "message",
      id: message.id,
      message,
      outbox: entry.outbox,
      showSender: !message.isMine && !continuesRun,
      // Provisional; resolved in the backward pass below.
      showTime: true,
      senderKey,
    });

    previousSenderKey = senderKey;
    previousTimestamp = timestamp;
  }

  // A bubble shows its timestamp only when it ends a run.
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.kind !== "message") continue;
    const next = rows[index + 1];
    const sameRun =
      next?.kind === "message" &&
      next.senderKey === row.senderKey &&
      (Date.parse(next.message.createdAt) || 0) - (Date.parse(row.message.createdAt) || 0) < RUN_GAP_MS;
    row.showTime = !sameRun;
  }

  // Inverted list renders index 0 at the bottom, so newest must come first.
  return rows.reverse();
}
