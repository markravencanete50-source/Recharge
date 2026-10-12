import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { noticeCopy } from "../../lib/notice-copy";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { MotionPress } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { readableStage, type NoticeView } from "../../lib/workspace-view";
import type { DepartmentTone } from "../../lib/workspace-map";
import type { OperationView } from "../../lib/workflow-forms";

// Shared rows for the live workspace, drawn like the redesign's work and activity rows.
const hoverTint = Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {};
export const isDone = (status: string) => ["completed", "cancelled", "declined"].includes(status);
export const isWaitingWork = (status: string) => ["waiting", "in_review"].includes(status);
// Repairs and visits carry their date on the work item; cleans also keep it in their details.
export const workDate = (item: OperationView) => item.dueOn ?? (typeof item.data.dueOn === "string" ? item.data.dueOn : "");

function kindLook(kind: string): { icon: DimensionalName; tone: DepartmentTone } {
  if (/clean/.test(kind)) return { icon: "spray", tone: "cleans" };
  if (/repair|maint|routine|inspect/.test(kind)) return { icon: "hardhat", tone: "ready" };
  if (/onboard|enquiry/.test(kind)) return { icon: "key", tone: "clients" };
  if (/invoice|payment|payout|expense|statement/.test(kind)) return { icon: "coins", tone: "accounts" };
  if (/booking|stay|guest/.test(kind)) return { icon: "calendar", tone: "stays" };
  return { icon: "clipboard", tone: "stays" };
}
export const shortDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";

export function LiveWorkRow({ item, property, palette: p, onPress }: { item: OperationView; property?: string; palette: Palette; onPress: () => void }) {
  const look = kindLook(item.kind), done = isDone(item.status), waiting = isWaitingWork(item.status);
  const status = done ? { icon: "check-circle" as const, ink: p.success, wash: p.successWash } : waiting ? { icon: "clock" as const, ink: p.waiting, wash: p.cautionWash } : { icon: "activity" as const, ink: p.primary, wash: p.wash };
  const date = shortDate(workDate(item)), urgent = item.data.sameDayTurnover === true;
  return (
    <MotionPress {...hoverTint} accessibilityRole="button" accessibilityLabel={`${item.title}, ${property ?? ""}, ${readableStage(item.status)}`} onPress={onPress} style={[ui.row, { gap: 14, paddingVertical: 14, paddingHorizontal: 12, marginHorizontal: -12, borderRadius: 18 }]}>
      <View style={{ backgroundColor: p.wash, width: 48, height: 48, borderRadius: 16, justifyContent: "center", alignItems: "center" }}><DimensionalIcon name={look.icon} size={36} color={p.primary} /></View>
      <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{item.title}</Text>
        {!!property && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{property}</Text>}
        <View style={[ui.row, { gap: 8, flexWrap: "wrap", marginTop: 2 }]}>
          <View style={[ui.row, { backgroundColor: status.wash, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, gap: 5 }]}>
            <Feather name={status.icon} size={12} color={status.ink} />
            <Text style={{ fontSize: 12, lineHeight: 18, color: p.text, fontWeight: "600" }}>{readableStage(item.status)}</Text>
          </View>
          {urgent && <View style={[ui.row, { backgroundColor: p.cautionWash, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, gap: 5 }]}><Feather name="zap" size={12} color={p.waiting} /><Text style={{ fontSize: 12, lineHeight: 18, color: p.text, fontWeight: "600" }}>Same-day turnover</Text></View>}
          {!!date && <Text style={{ fontSize: 12, lineHeight: 18, color: p.muted }}>{date}</Text>}
        </View>
      </View>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: p.elevated, alignItems: "center", justifyContent: "center" }}><Feather name="chevron-right" size={16} color={p.text} /></View>
    </MotionPress>
  );
}

// Updates are named by area ("chat.message", "operations.updateOperation.bookRepair"), so each
// area gets its own icon; repair steps inside operations read as repairs.
const NOTICE_LOOKS: Record<string, { icon: DimensionalName; tone: DepartmentTone }> = {
  chat: { icon: "chat", tone: "stays" }, message: { icon: "chat", tone: "stays" },
  journey: { icon: "key", tone: "clients" }, onboarding: { icon: "key", tone: "clients" },
  repairs: { icon: "hardhat", tone: "ready" }, routine: { icon: "hardhat", tone: "ready" },
  cleaning: { icon: "spray", tone: "cleans" }, finance: { icon: "coins", tone: "accounts" },
  reports: { icon: "chart", tone: "clients" }, reservation: { icon: "calendar", tone: "stays" },
  stays: { icon: "calendar", tone: "stays" }, training: { icon: "medal", tone: "stays" },
  handover: { icon: "people", tone: "stays" },
};
function noticeLook(type: string): { icon: DimensionalName; tone: DepartmentTone } {
  const [area = "", ...rest] = type.split(".");
  if (area === "operations") return /reservation/i.test(type) ? NOTICE_LOOKS.reservation : kindLook(/cleaning/i.test(type) ? "clean" : "repair");
  return NOTICE_LOOKS[area] ?? kindLook(rest.join("."));
}
export function LiveNoticeRow({ notice, palette: p }: { notice: NoticeView; palette: Palette }) {
  const look = noticeLook(notice.event_type);
  const when = new Date(notice.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[ui.row, { gap: 14, paddingVertical: 12 }]}>
      <View style={{ backgroundColor: p.wash, width: 42, height: 42, borderRadius: 14, justifyContent: "center", alignItems: "center" }}><DimensionalIcon name={look.icon} size={30} color={p.primary} /></View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{noticeCopy(notice.event_type).title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{when}</Text>
      </View>
    </View>
  );
}
