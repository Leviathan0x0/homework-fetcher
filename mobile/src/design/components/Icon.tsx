import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

import { useTheme } from "../theme";

type MaterialGlyph = ComponentProps<typeof MaterialIcons>["name"];

/**
 * Every icon the app uses, with a platform-correct pair.
 *
 * The SF Symbol name is only ever read on iOS and the Material Symbol only on
 * Android, so an SF name can never ship to Android. Adding an icon means adding
 * a row here — screens cannot pass a raw glyph name.
 */
const ICON_REGISTRY = {
  // Tabs
  today: { sf: "checklist", material: "checklist" },
  classwork: { sf: "folder", material: "folder" },
  requests: { sf: "hand.raised", material: "back-hand" },
  messages: { sf: "bubble.left.and.bubble.right", material: "forum" },
  notifications: { sf: "bell", material: "notifications-none" },
  settings: { sf: "gearshape", material: "settings" },

  // Actions
  add: { sf: "plus", material: "add" },
  close: { sf: "xmark", material: "close" },
  check: { sf: "checkmark", material: "check" },
  checkAll: { sf: "checkmark.circle", material: "done-all" },
  circle: { sf: "circle", material: "radio-button-unchecked" },
  circleFilled: { sf: "checkmark.circle.fill", material: "check-circle" },
  trash: { sf: "trash", material: "delete-outline" },
  send: { sf: "arrow.up.circle.fill", material: "send" },
  search: { sf: "magnifyingglass", material: "search" },
  refresh: { sf: "arrow.clockwise", material: "refresh" },
  edit: { sf: "pencil", material: "edit" },
  back: { sf: "chevron.left", material: "arrow-back" },
  chevronRight: { sf: "chevron.right", material: "chevron-right" },
  chevronDown: { sf: "chevron.down", material: "expand-more" },
  signOut: { sf: "rectangle.portrait.and.arrow.right", material: "logout" },

  // Attachments & media
  attach: { sf: "paperclip", material: "attach-file" },
  camera: { sf: "camera", material: "camera-alt" },
  photos: { sf: "photo.on.rectangle", material: "photo-library" },
  document: { sf: "doc", material: "insert-drive-file" },
  pdf: { sf: "doc.richtext", material: "picture-as-pdf" },
  image: { sf: "photo", material: "image" },
  download: { sf: "arrow.down.circle", material: "file-download" },
  newChat: { sf: "square.and.pencil", material: "add-comment" },

  // Status
  person: { sf: "person", material: "person" },
  lock: { sf: "lock", material: "lock-outline" },
  eye: { sf: "eye", material: "visibility" },
  eyeOff: { sf: "eye.slash", material: "visibility-off" },
  offline: { sf: "wifi.slash", material: "wifi-off" },
  warning: { sf: "exclamationmark.triangle", material: "warning-amber" },
  error: { sf: "exclamationmark.circle", material: "error-outline" },
  info: { sf: "info.circle", material: "info-outline" },
  clock: { sf: "clock", material: "schedule" },
  note: { sf: "text.alignleft", material: "notes" },
  section: { sf: "person.3", material: "groups" },
  theme: { sf: "circle.lefthalf.filled", material: "contrast" },
  emptyBox: { sf: "tray", material: "inbox" },
} as const satisfies Record<string, { sf: SFSymbol; material: MaterialGlyph }>;

export type IconName = keyof typeof ICON_REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  /** Defaults to the primary text colour. */
  color?: string;
  weight?: SymbolWeight;
  /**
   * Hierarchical rendering gives SF Symbols their depth. Turn it off for a flat
   * monochrome glyph (e.g. inside a filled button where contrast matters more).
   */
  hierarchical?: boolean;
}

/**
 * SF Symbols on iOS via expo-symbols, Material Symbols on Android.
 *
 * Icons are decorative here: they are always paired with a label or sit inside a
 * control that carries its own `accessibilityLabel`, so this renders as
 * `accessibilityElementsHidden` and is skipped by the screen reader.
 */
export function Icon({ name, size = 20, color, weight = "regular", hierarchical = true }: IconProps) {
  const { colors } = useTheme();
  const tint = color ?? colors.text;
  const entry = ICON_REGISTRY[name];

  if (Platform.OS === "ios") {
    return (
      <SymbolView
        name={entry.sf}
        size={size}
        tintColor={tint}
        type={hierarchical ? "hierarchical" : "monochrome"}
        weight={weight}
        resizeMode="scaleAspectFit"
        accessibilityElementsHidden
        importantForAccessibility="no"
        // Fall back to the Material glyph if a symbol is missing on an older iOS.
        fallback={<MaterialIcons name={entry.material} size={size} color={tint} />}
      />
    );
  }

  return (
    <MaterialIcons
      name={entry.material}
      size={size}
      color={tint}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
