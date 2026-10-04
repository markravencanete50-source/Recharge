import { Image, View } from "react-native";
import type { ModuleId } from "./model";
// Metro requires static require calls for bundled native image assets.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro resolves these static native image assets. */
const files = [
  require("../assets/recharge/recharge-tools-1.png"),
  require("../assets/recharge/recharge-tools-2.png"),
];
const ids: ModuleId[][] = [
  [
    "clean-client-database",
    "cleaner-database",
    "client-dashboard",
    "clean-reporting",
    "clean-property-onboarding",
    "cleaner-performance",
    "cleaning-schedule",
    "ready-schedule",
    "maintenance-reporting",
    "stays-maintenance-reporting",
    "client-property-maintenance",
    "property-database",
    "property-onboarding",
    "direct-bookings",
    "new-property-inspection-board",
    "safety-maintenance",
    "routine-bin-garden-board",
    "guest-communication",
    "client-mailbox",
    "purchase-order",
  ],
  [
    "purchase-order-requests",
    "client-purchase-order-quotes",
    "replenishment-requests",
    "property-furnishing-board",
    "client-furnishing",
    "aircover-reporting",
    "ota-logins",
    "licensing",
    "daily-pricing",
    "weekly-performance",
    "listing-health",
    "cleans-invoices",
    "maintenance-reconciliation",
    "onboarding-invoices",
    "purchase-order-invoices",
    "purchase-order-accounts",
    "owner-statements",
  ],
];
const bounds = [
  [
    [22, 25, 256, 273],
    [338, 28, 231, 271],
    [595, 48, 205, 252],
    [848, 33, 255, 267],
    [1107, 36, 286, 269],
    [44, 310, 265, 251],
    [300, 301, 268, 264],
    [590, 313, 237, 251],
    [841, 326, 263, 237],
    [1122, 292, 262, 280],
    [25, 587, 268, 237],
    [295, 566, 279, 247],
    [581, 573, 249, 245],
    [849, 580, 269, 236],
    [1111, 570, 284, 252],
    [8, 860, 280, 220],
    [289, 829, 281, 272],
    [584, 868, 250, 213],
    [876, 830, 236, 260],
    [1114, 829, 282, 268],
  ],
  [
    [33, 65, 270, 245],
    [298, 76, 255, 235],
    [579, 86, 259, 230],
    [854, 71, 249, 243],
    [1110, 94, 276, 218],
    [80, 329, 211, 228],
    [308, 331, 255, 233],
    [573, 327, 247, 234],
    [841, 339, 268, 219],
    [1134, 335, 230, 230],
    [53, 566, 240, 249],
    [300, 569, 273, 247],
    [576, 583, 242, 239],
    [830, 584, 259, 224],
    [1118, 567, 263, 242],
    [41, 834, 264, 222],
    [327, 839, 228, 228],
  ],
];
export function Artwork({ id, size = 68 }: { id: ModuleId; size?: number }) {
  const atlas = ids[0].includes(id) ? 0 : 1;
  const [x, y, width, height] = bounds[atlas][ids[atlas].indexOf(id)];
  const scale = (size * 0.9) / Math.max(width, height);
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: width * scale,
          height: height * scale,
          overflow: "hidden",
        }}
      >
        <Image
          source={files[atlas]}
          resizeMode="stretch"
          style={{
            position: "absolute",
            width: 1402 * scale,
            height: 1122 * scale,
            left: -x * scale,
            top: -y * scale,
          }}
        />
      </View>
    </View>
  );
}
