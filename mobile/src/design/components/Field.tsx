import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, radii, spacing } from "../tokens";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface FieldProps extends Omit<TextInputProps, "style" | "placeholderTextColor"> {
  label: string;
  /** Validation or server error. Presence switches the field to its error style. */
  error?: string | null;
  /** Helper copy shown when there is no error. */
  hint?: string;
  /** Renders a reveal toggle and starts obscured. */
  secure?: boolean;
  /** Shows a live `used/limit` counter. Also enforced via `maxLength`. */
  showCounter?: boolean;
}

/**
 * Labelled text input.
 *
 * The label is a real `<Text>` above the field rather than a placeholder, so it
 * stays readable at large Dynamic Type sizes and is announced correctly.
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, secure = false, showCounter = false, maxLength, value, multiline, ...rest },
  ref,
) {
  const { colors, typography } = useTheme();
  const [revealed, setRevealed] = useState(false);

  const hasError = Boolean(error);
  const length = typeof value === "string" ? value.length : 0;
  const overLimit = typeof maxLength === "number" && length > maxLength;

  return (
    <View style={styles.root}>
      <View style={styles.labelRow}>
        <Text variant="footnote" tone="secondary" weight="600">
          {label}
        </Text>
        {showCounter && typeof maxLength === "number" ? (
          <Text variant="caption" tone={overLimit ? "danger" : "tertiary"} tabular>
            {length}/{maxLength}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: colors.fill,
            borderColor: hasError ? colors.danger : "transparent",
            minHeight: multiline ? 96 : MIN_TOUCH_TARGET,
            alignItems: multiline ? "flex-start" : "center",
          },
        ]}
      >
        <TextInput
          ref={ref}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          maxFontSizeMultiplier={1.4}
          style={[
            styles.input,
            {
              color: colors.text,
              fontSize: typography.body.fontSize,
              lineHeight: multiline ? typography.body.lineHeight : undefined,
              textAlignVertical: multiline ? "top" : "center",
              paddingTop: multiline ? spacing.md : 0,
              paddingBottom: multiline ? spacing.md : 0,
            },
          ]}
          {...rest}
        />

        {secure ? (
          <Pressable
            onPress={() => setRevealed((current) => !current)}
            hitSlop={12}
            style={styles.reveal}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
          >
            <Icon name={revealed ? "eyeOff" : "eye"} size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputWrap: {
    flexDirection: "row",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
  reveal: {
    width: 32,
    alignItems: "flex-end",
    justifyContent: "center",
    alignSelf: "center",
  },
});
