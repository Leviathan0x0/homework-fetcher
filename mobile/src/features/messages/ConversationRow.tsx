import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Conversation } from "../../api/types";
import { Avatar, Icon, Text, radii, spacing, useTheme } from "../../design";
import { MIN_TOUCH_TARGET } from "../../design/tokens";
import { formatRelativeTime } from "../../utils/datetime";

/** Fixed so the conversation list can supply `getItemLayout`. */
export const CONVERSATION_ROW_HEIGHT = 72;

export interface ConversationRowProps {
  conversation: Conversation;
  onPress: (conversation: Conversation) => void;
}

/**
 * One conversation.
 *
 * The primary label is `displayName || studentId` — a raw student ID is only ever
 * a fallback, never shown in place of a name someone has set.
 */
export const ConversationRow = memo(function ConversationRow({ conversation, onPress }: ConversationRowProps) {
  const { colors } = useTheme();
  const other = conversation.otherUser;

  const name = other?.displayName?.trim() || other?.studentId || "Unknown student";
  const hasUnread = conversation.unreadCount > 0;
  const preview = conversation.lastMessagePreview ?? "No messages yet";
  const time = conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : "";

  return (
    <Pressable
      onPress={() => onPress(conversation)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        hasUnread
          ? `${name}, ${conversation.unreadCount} unread. ${preview}`
          : `${name}. ${preview}`
      }
      accessibilityHint="Opens this conversation"
    >
      <Avatar id={other?.id ?? conversation.id} displayName={other?.displayName} studentId={other?.studentId} size={44} />

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text variant="headline" numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {time ? (
            <Text variant="caption" tone={hasUnread ? "accent" : "tertiary"} tabular>
              {time}
            </Text>
          ) : null}
        </View>

        <View style={styles.bottomLine}>
          <Text
            variant="footnote"
            tone={hasUnread ? "primary" : "secondary"}
            weight={hasUnread ? "600" : "400"}
            numberOfLines={1}
            style={styles.preview}
          >
            {preview}
          </Text>
          {hasUnread ? (
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text variant="caption" weight="700" tabular style={{ color: colors.textOnAccent }}>
                {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
              </Text>
            </View>
          ) : (
            <Icon name="chevronRight" size={14} color={colors.textTertiary} />
          )}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: CONVERSATION_ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  preview: {
    flex: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
