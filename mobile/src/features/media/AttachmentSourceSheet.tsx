import { Sheet, Text, spacing, useTheme } from "../../design";
import { Icon, type IconName } from "../../design/components/Icon";
import { MIN_TOUCH_TARGET, radii } from "../../design/tokens";
import { Pressable, StyleSheet, View } from "react-native";

import type { PickSource } from "./pickAttachment";

interface SourceOption {
  source: PickSource;
  icon: IconName;
  label: string;
  detail: string;
}

const OPTIONS: SourceOption[] = [
  { source: "camera", icon: "camera", label: "Take photo", detail: "Compressed before upload" },
  { source: "library", icon: "photos", label: "Photo library", detail: "Compressed before upload" },
  { source: "document", icon: "document", label: "Document", detail: "PDF, Word, Excel, text" },
];

export interface AttachmentSourceSheetProps {
  visible: boolean;
  onClose: () => void;
  onPick: (source: PickSource) => void;
}

/**
 * Camera / library / document chooser.
 *
 * Shared by the chat composer and the classwork upload sheet so the three entry
 * points stay identical, including the note that photos are compressed — which
 * sets the expectation before someone picks an 8 MB photo.
 */
export function AttachmentSourceSheet({ visible, onClose, onPick }: AttachmentSourceSheetProps) {
  const { colors } = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose} title="Add attachment">
      <View style={styles.list}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.source}
            onPress={() => {
              onClose();
              onPick(option.source);
            }}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? colors.surfacePressed : colors.fill },
            ]}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityHint={option.detail}
          >
            <View style={[styles.iconWell, { backgroundColor: colors.accentMuted }]}>
              <Icon name={option.icon} size={19} color={colors.accent} />
            </View>
            <View style={styles.labels}>
              <Text variant="callout" weight="600">
                {option.label}
              </Text>
              <Text variant="caption" tone="tertiary">
                {option.detail}
              </Text>
            </View>
            <Icon name="chevronRight" size={15} color={colors.textTertiary} />
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET + 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  labels: {
    flex: 1,
  },
});
