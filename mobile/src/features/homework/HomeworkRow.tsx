import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import type { HomeworkItem } from "../../api/types";
import { Chip, Icon, MIN_TOUCH_TARGET, Text, radii, spacing, useTheme } from "../../design";
import { subjectTint } from "./grouping";

/** Horizontal distance that commits the swipe action. */
const COMMIT_THRESHOLD = 84;
/** Rubber-band ceiling so the row cannot be dragged off screen. */
const MAX_TRANSLATE = 132;

export interface HomeworkRowProps {
  item: HomeworkItem;
  onToggleComplete: (item: HomeworkItem, completed: boolean) => void;
  onSaveNote: (item: HomeworkItem, note: string | null) => void;
  /** Set when the last note save for this row failed, so the draft is kept visible. */
  noteError?: string | null;
}

/**
 * One homework assignment.
 *
 * Two ways to complete an item, on purpose:
 *  - swipe right — fast, discoverable, gives haptic confirmation
 *  - the leading checkbox — the accessible path, since a swipe is not reachable
 *    with a screen reader or a switch control
 *
 * Notes expand inline. The draft is local state and is deliberately *not* cleared
 * when a save fails, so nothing typed is ever lost to a network error.
 */
export const HomeworkRow = memo(function HomeworkRow({
  item,
  onToggleComplete,
  onSaveNote,
  noteError,
}: HomeworkRowProps) {
  const { colors, isDark, reduceMotion, spring: springConfig } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.note ?? "");

  // Adopt server changes only while the editor is closed, so remote polling never
  // overwrites what someone is mid-way through typing.
  useEffect(() => {
    if (!expanded) setDraft(item.note ?? "");
  }, [item.note, expanded]);

  const translateX = useSharedValue(0);

  const commitComplete = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onToggleComplete(item, !item.completed);
  }, [item, onToggleComplete]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // Only claim the gesture once it is clearly horizontal, so the parent list
        // keeps its vertical scroll.
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          const next = Math.max(0, Math.min(event.translationX, MAX_TRANSLATE));
          translateX.value = next;
        })
        .onEnd(() => {
          if (translateX.value >= COMMIT_THRESHOLD) {
            runOnJS(commitComplete)();
          }
          translateX.value = withSpring(0, springConfig);
        }),
    [commitComplete, springConfig, translateX],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reduceMotion ? 0 : translateX.value }],
  }));

  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, COMMIT_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(translateX.value, [0, COMMIT_THRESHOLD], [0.8, 1], Extrapolation.CLAMP) },
    ],
  }));

  const saveNote = useCallback(() => {
    const trimmed = draft.trim();
    const previous = item.note ?? "";
    if (trimmed === previous.trim()) return;
    onSaveNote(item, trimmed.length > 0 ? trimmed : null);
  }, [draft, item, onSaveNote]);

  const toggleFromCheckbox = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggleComplete(item, !item.completed);
  }, [item, onToggleComplete]);

  return (
    <View style={styles.container}>
      {/* Swipe affordance revealed beneath the row. */}
      <View style={[styles.actionLayer, { backgroundColor: colors.success }]}>
        <Animated.View style={actionStyle}>
          <Icon name="check" size={20} color="#FFFFFF" weight="bold" hierarchical={false} />
        </Animated.View>
      </View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.row, { backgroundColor: colors.surface }, rowStyle]}>
          <Pressable
            onPress={toggleFromCheckbox}
            hitSlop={8}
            style={styles.checkbox}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            accessibilityLabel={`Mark ${item.subject ?? item.type} as ${item.completed ? "not done" : "done"}`}
          >
            <Icon
              name={item.completed ? "circleFilled" : "circle"}
              size={22}
              color={item.completed ? colors.success : colors.textTertiary}
            />
          </Pressable>

          <Pressable
            style={styles.body}
            onPress={() => setExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={item.homework}
            accessibilityHint={expanded ? "Collapses the note" : "Expands to add a note"}
          >
            <View style={styles.metaRow}>
              {item.subject ? <Chip label={item.subject} tint={subjectTint(item.subject, isDark)} /> : null}
              <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.type}>
                {item.type}
              </Text>
              {item.attachment ? <Icon name="attach" size={13} color={colors.textTertiary} /> : null}
              {item.note ? <Icon name="note" size={13} color={colors.accent} /> : null}
            </View>

            <Text
              variant="callout"
              numberOfLines={expanded ? undefined : 3}
              tone={item.completed ? "tertiary" : "primary"}
              style={item.completed ? styles.completedText : undefined}
            >
              {item.homework}
            </Text>

            {expanded ? (
              <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(150)} style={styles.noteBlock}>
                <Text variant="caption" tone="secondary" weight="600">
                  Note
                </Text>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onBlur={saveNote}
                  multiline
                  placeholder="Add a reminder for yourself…"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.accent}
                  maxFontSizeMultiplier={1.4}
                  accessibilityLabel="Note for this assignment"
                  style={[styles.noteInput, { color: colors.text, backgroundColor: colors.fill }]}
                />
                {noteError ? (
                  <Text variant="caption" tone="danger">
                    {noteError} Your note is still here — try saving again.
                  </Text>
                ) : (
                  <Text variant="caption" tone="tertiary">
                    Saved automatically when you tap away.
                  </Text>
                )}
              </Animated.View>
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  actionLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: spacing.xxl,
  },
  row: {
    flexDirection: "row",
    borderRadius: radii.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
  },
  checkbox: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET - 12,
    alignItems: "center",
    paddingTop: 2,
  },
  body: {
    flex: 1,
    gap: spacing.xs + 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  type: {
    flexShrink: 1,
  },
  completedText: {
    textDecorationLine: "line-through",
  },
  noteBlock: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  noteInput: {
    minHeight: 68,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
  },
});
