import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LIMITS } from "../../api/config";
import { formatFileSize, isImageMimeType } from "../../api/files";
import type { LocalFile } from "../../api/types";
import { GlassSurface, Icon, Text, radii, spacing, useTheme } from "../../design";
import { MIN_TOUCH_TARGET } from "../../design/tokens";

const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 120;
/** Only show the counter when the limit is actually in sight. */
const COUNTER_VISIBLE_FROM = LIMITS.maxMessageChars - 200;

export interface ComposerProps {
  value: string;
  onChangeText: (next: string) => void;
  attachment: LocalFile | null;
  onRequestAttachment: () => void;
  onClearAttachment: () => void;
  onSend: () => void;
  /** True while a photo is being picked or compressed. */
  preparing?: boolean;
  /** Attachment picking / compression failure, or a rate-limit notice. */
  notice?: { tone: "danger" | "warning"; message: string } | null;
}

/**
 * Chat composer on glass.
 *
 * The input grows with its content up to a ceiling and then scrolls, so a long
 * message never pushes the send button off screen. Send is disabled unless there
 * is something to send, which is also what prevents the empty-payload 400 the
 * server would otherwise return.
 */
export function Composer({
  value,
  onChangeText,
  attachment,
  onRequestAttachment,
  onClearAttachment,
  onSend,
  preparing = false,
  notice = null,
}: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);

  const trimmed = value.trim();
  const overLimit = value.length > LIMITS.maxMessageChars;
  const canSend = (trimmed.length > 0 || attachment !== null) && !overLimit && !preparing;

  return (
    <GlassSurface intensity={90} edge="top" style={[styles.root, { paddingBottom: insets.bottom + spacing.sm }]}>
      {notice ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: notice.tone === "danger" ? colors.dangerMuted : colors.fillStrong },
          ]}
          accessibilityRole="alert"
        >
          <Icon
            name={notice.tone === "danger" ? "error" : "clock"}
            size={14}
            color={notice.tone === "danger" ? colors.danger : colors.warning}
          />
          <Text
            variant="caption"
            style={{ color: notice.tone === "danger" ? colors.danger : colors.warning, flex: 1 }}
          >
            {notice.message}
          </Text>
        </View>
      ) : null}

      {attachment ? (
        <View style={[styles.attachmentChip, { backgroundColor: colors.fill }]}>
          {isImageMimeType(attachment.type) ? (
            <Image source={{ uri: attachment.uri }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.center, { backgroundColor: colors.fillStrong }]}>
              <Icon name="document" size={16} color={colors.textSecondary} />
            </View>
          )}
          <View style={styles.attachmentMeta}>
            <Text variant="caption" weight="600" numberOfLines={1}>
              {attachment.name}
            </Text>
            <Text variant="caption" tone="tertiary" tabular>
              {attachment.size ? `${formatFileSize(attachment.size)} · ready to send` : "Ready to send"}
            </Text>
          </View>
          <Pressable
            onPress={onClearAttachment}
            hitSlop={12}
            style={styles.removeAttachment}
            accessibilityRole="button"
            accessibilityLabel={`Remove attachment ${attachment.name}`}
          >
            <Icon name="close" size={15} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <Pressable
          onPress={onRequestAttachment}
          disabled={preparing}
          hitSlop={8}
          style={styles.attachButton}
          accessibilityRole="button"
          accessibilityLabel="Add an attachment"
          accessibilityState={{ disabled: preparing }}
        >
          {preparing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Icon name="attach" size={20} color={colors.textSecondary} />
          )}
        </Pressable>

        <View
          style={[
            styles.inputWrap,
            { backgroundColor: colors.fill, borderColor: overLimit ? colors.danger : "transparent" },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder="Message"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            multiline
            // Let the platform enforce a hard stop a little above the server limit
            // so paste cannot blow past it, while the counter explains why.
            maxLength={LIMITS.maxMessageChars + 200}
            maxFontSizeMultiplier={1.4}
            accessibilityLabel="Message"
            onContentSizeChange={(event) => {
              const next = event.nativeEvent.contentSize.height;
              setInputHeight(Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, next)));
            }}
            style={[styles.input, { color: colors.text, height: inputHeight }]}
          />
        </View>

        <Pressable
          onPress={onSend}
          disabled={!canSend}
          hitSlop={8}
          style={styles.sendButton}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          <Icon
            name="send"
            size={26}
            color={canSend ? colors.accent : colors.textTertiary}
            weight="semibold"
            hierarchical={false}
          />
        </Pressable>
      </View>

      {value.length >= COUNTER_VISIBLE_FROM ? (
        <Text variant="caption" tone={overLimit ? "danger" : "tertiary"} tabular style={styles.counter}>
          {value.length}/{LIMITS.maxMessageChars}
          {overLimit ? " — too long to send" : ""}
        </Text>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
  },
  attachmentMeta: {
    flex: 1,
  },
  removeAttachment: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  attachButton: {
    width: MIN_TOUCH_TARGET - 8,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrap: {
    flex: 1,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: "center",
    minHeight: MIN_TOUCH_TARGET,
  },
  input: {
    fontSize: 16,
    lineHeight: 21,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    textAlignVertical: "top",
  },
  sendButton: {
    width: MIN_TOUCH_TARGET - 8,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: {
    textAlign: "right",
    paddingRight: spacing.sm,
  },
});
