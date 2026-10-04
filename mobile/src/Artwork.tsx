import type { ComponentProps } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import type { ModuleId } from "./model";
import { WORKSPACE_MAP } from "../../lib/workspace-map";
import { departmentColor, themes, type Palette } from "./theme";

// Every feature has a distinct vector symbol. Shared geometry keeps the family coherent.
export const FEATURE_ICONS: Record<
  ModuleId,
  ComponentProps<typeof Feather>["name"]
> = {
  "clean-client-database": "users",
  "cleaner-database": "user-check",
  "client-dashboard": "pie-chart",
  "clean-reporting": "clipboard",
  "clean-property-onboarding": "check-square",
  "cleaner-performance": "award",
  "cleaning-schedule": "calendar",
  "ready-schedule": "clock",
  "maintenance-reporting": "tool",
  "stays-maintenance-reporting": "activity",
  "client-property-maintenance": "alert-circle",
  "property-database": "home",
  "property-onboarding": "key",
  "direct-bookings": "bookmark",
  "new-property-inspection-board": "search",
  "safety-maintenance": "shield",
  "routine-bin-garden-board": "sun",
  "guest-communication": "message-circle",
  "client-mailbox": "mail",
  "purchase-order": "shopping-bag",
  "purchase-order-requests": "send",
  "client-purchase-order-quotes": "file-text",
  "replenishment-requests": "package",
  "property-furnishing-board": "layout",
  "client-furnishing": "sliders",
  "aircover-reporting": "umbrella",
  "ota-logins": "lock",
  licensing: "file",
  "daily-pricing": "trending-up",
  "weekly-performance": "bar-chart-2",
  "listing-health": "check-circle",
  "cleans-invoices": "dollar-sign",
  "maintenance-reconciliation": "git-merge",
  "onboarding-invoices": "file-plus",
  "purchase-order-invoices": "credit-card",
  "purchase-order-accounts": "briefcase",
  "owner-statements": "book-open",
};
export function Artwork({
  id,
  size = 48,
  palette = themes.light,
}: {
  id: ModuleId;
  size?: number;
  palette?: Palette;
}) {
  const tone = departmentColor(WORKSPACE_MAP[id].tone, palette);
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: tone.wash,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: size * 0.2,
          backgroundColor: tone.ink,
          opacity: 0.07,
          transform: [{ rotate: "-12deg" }],
        }}
      />
      <Feather name={FEATURE_ICONS[id]} size={size * 0.47} color={tone.ink} />
    </View>
  );
}
