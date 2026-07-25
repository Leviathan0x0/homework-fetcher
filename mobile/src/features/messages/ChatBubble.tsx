import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { formatFileSize, isImageMimeType } from "../../api/files";
import { inlineErrorMessage } from "../../api/errors";
import { AuthedFileRow, AuthedImage, Icon, Text, radii, spacing, useTheme } from "../../design";
import { formatClockTime } from "../../utils/datetime";
import type { MessageRow } from "./timeline";

const BUBBLE_MAX_WIDTH = "78%";
const ATTACHMENT_HEIGHT = 190;

export interface ChatBubbleProps {
  row: MessageRow;
  onOpenImage: (path: string, filename: string | null) => void;
  onRetry: (localId: string) => void;
  onDiscard: (localId: string) => void;
}

/**
 * One message bubble.
 *
 * Handles four states: incoming, confirmed outgoing, pending outgoing (dimmed with
 * a clock) and failed outgoing (explains why, offers Retry and Discard). A failed
 * bubble stays on screen holding its content — discarding it puts the text back in
 * the composer rather than throwing it away.
 */
export const ChatBubble = memo(function ChatBubble({ row, onOpenImage, onRetry, onDiscard }: ChatBubbleProps) {
  const { colors } = useTheme();
  const { message, outbox, showSender, showTime } = row;

  const mine = message.isMine;
  const failed = outbox?.status === "failed";
  const sending = outbox?.status === "sending";

  const bubbleColor = mine ? colors.accent : colors.surface;
  const textTone = mine ? colors.textOnAccent : colors.text;
  const metaTone = mine ? "rgba(255,255,255,0.78)" : colors.textTertiary;

  // Captured in a local so the narrowing survives into the JSX below.
  const remoteAttachmentUrl = message.attachmentUrl;
  const hasImageAttachment =
    (remoteAttachmentUrl !== null && isImageMimeType(message.mimeType)) ||
    (outbox?.file != null && isImageMimeType(outbox.file.type));

  return (
    <View style={[styles.container, mine ? styles.alignEnd : styles.alignStart]}>
      {showSender && message.senderName ? (
        <Text variant="caption" tone="secondary" weight="600" style={styles.senderName}>
          {message.senderName}
        </Text>
      ) : null}

      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderBottomRightRadius: mine ? radii.sm : radii.lg,
            borderBottomLeftRadius: mine ? radii.lg : radii.sm,
            opacity: sending ? 0.72 : 1,
            borderColor: failed ? colors.danger : "transparent",
            borderWidth: failed ? StyleSheet.hairlineWidth * 2 : 0,
          },
        ]}
        accessible
        accessibilityLabel={[
          message.senderName && !mine ? `${message.senderName}:` : mine ? "You:" : "",
          message.content,
          message.originalFilename ? `Attachment ${message.originalFilename}` : "",
          formatClockTime(message.createdAt),
          sending ? "Sending" : failed ? "Failed to send" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Attachment. A pending outbox item previews the local file directly —
            it has no server URL yet. */}
        {hasImageAttachment ? (
          outbox?.file ? (
            <Image
              source={{ uri: outbox.file.uri }}
              style={[styles.attachment, { backgroundColor: colors.fill }]}
              contentFit="cover"
              accessible
              accessibilityLabel="Photo being sent"
            />
          ) : remoteAttachmentUrl ? (
            <AuthedImage
              path={remoteAttachmentUrl}
              style={styles.attachment}
              accessibilityLabel={message.originalFilename ?? "Photo attachment"}
              onPress={() => onOpenImage(remoteAttachmentUrl, message.originalFilename)}
            />
          ) : null
        ) : null}

        {!hasImageAttachment && remoteAttachmentUrl && message.originalFilename ? (
          <View style={styles.fileWrap}>
            <AuthedFileRow
              path={remoteAttachmentUrl}
              filename={message.originalFilename}
              mimeType={message.mimeType}
              cacheKey={message.id}
              onAccent={mine}
            />
          </View>
        ) : null}

        {!hasImageAttachment && outbox?.file ? (
          <View style={[styles.pendingFile, { backgroundColor: "rgba(255,255,255,0.16)" }]}>
            <Icon name="document" size={16} color={metaTone} />
            <Text variant="caption" numberOfLines={1} style={{ color: metaTone, flex: 1 }}>
              {outbox.file.name}
              {outbox.file.size ? ` · ${formatFileSize(outbox.file.size)}` : ""}
            </Text>
          </View>
        ) : null}

        {message.content ? (
          <Text variant="callout" style={{ color: textTone }}>
            {message.content}
          </Text>
        ) : null}

        {showTime || sending || failed ? (
          <View style={styles.metaRow}>
            {sending ? <Icon name="clock" size={11} color={metaTone} /> : null}
            <Text variant="caption" tabular style={{ color: metaTone }}>
              {sending ? "Sending…" : failed ? "Not sent" : formatClockTime(message.createdAt)}
            </Text>
          </View>
        ) : null}
      </View>

      {failed && outbox ? (
        <View style={styles.failedActions}>
          <Text variant="caption" tone="danger" style={styles.failedReason}>
            {inlineErrorMessage(outbox.error)}
          </Text>
          <View style={styles.failedButtons}>
            <Pressable
              onPress={() => onRetry(outbox.localId)}
              hitSlop={10}
              style={styles.failedButton}
              accessibilityRole="button"
              accessibilityLabel="Retry sending this message"
            >
              <Icon name="refresh" size={13} color={colors.accent} weight="semibold" />
              <Text variant="caption" weight="600" tone="accent">
                Retry
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onDiscard(outbox.localId)}
              hitSlop={10}
              style={styles.failedButton}
              accessibilityRole="button"
              accessibilityLabel="Discard this message and put the text back in the composer"
            >
              <Text variant="caption" weight="600" tone="secondary">
                Edit
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
});

/** Day divider between message runs. */
export function ChatDateSeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.separator} accessibilityRole="header">
      <View style={[styles.separatorPill, { backgroundColor: colors.fill }]}>
        <Text variant="caption" tone="secondary" weight="600">
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    maxWidth: "100%",
  },
  alignStart: {
    alignItems: "flex-start",
  },
  alignEnd: {
    alignItems: "flex-end",
  },
  senderName: {
    paddingLeft: spacing.md,
    paddingBottom: 2,
  },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs + 2,
  },
  attachment: {
    width: 220,
    height: ATTACHMENT_HEIGHT,
    borderRadius: radii.sm,
  },
  fileWrap: {
    minWidth: 200,
  },
  pendingFile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 180,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-end",
  },
  failedActions: {
    alignItems: "flex-end",
    paddingTop: spacing.xs,
    gap: 2,
    maxWidth: BUBBLE_MAX_WIDTH,
  },
  failedReason: {
    textAlign: "right",
  },
  failedButtons: {
    flexDirection: "row",
    gap: spacing.md,
  },
  failedButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 28,
  },
  separator: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  separatorPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
