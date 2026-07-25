import { StyleSheet, View } from "react-native";

import { EmptyState, ScreenHeader, useTabScreenPadding, useTheme, type IconName } from "../design";

export interface ComingSoonScreenProps {
  title: string;
  icon: IconName;
  /** What this screen will do, so the placeholder is informative rather than blank. */
  detail: string;
  subtitle?: string;
}

/**
 * Placeholder for a screen scheduled in a later increment.
 *
 * It exists so the tab bar, glass chrome, safe areas and theming can be reviewed
 * end to end now. Each one is replaced wholesale by the real screen — there is no
 * placeholder logic to unpick.
 */
export function ComingSoonScreen({ title, icon, detail, subtitle }: ComingSoonScreenProps) {
  const { colors } = useTheme();
  const padding = useTabScreenPadding();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title={title} subtitle={subtitle} />
      <View style={[styles.body, { paddingTop: padding.top, paddingBottom: padding.bottom }]}>
        <EmptyState icon={icon} title="Coming next" detail={detail} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
