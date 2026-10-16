import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useWorkFocus } from "./LiveKit";
import { PageHeading } from "./LivePages";
import { ToolCards, ToolHeader, ToolTitled, type ToolCard } from "./ToolPage";
import { space, type Palette } from "./theme";

// The admins' Reports page as a hub (Lee, 16 October 2026: "something like a folder or button saying Timesheet report,
// Productivity report, Task report, Guest report; each report should have a different page"). The page lists one card per
// report, Business overview first; a card opens that report on its own page with "Reports" to come back. The reports
// are the ones the page already held, moved apart: nothing new is read. The host builds the list (LiveWorkspace.tsx).
//   `anchors`  the places a link can point at (Home's "Guest replies on time" points at the Messages report), so a link
//              opens that report's page and then scrolls to the place as before
//   `ownIntro` the report says what it covers under its heading already, so its page leaves out the card's line
export type HubReport = ToolCard<string> & { anchors?: readonly string[]; ownIntro?: boolean; page: ReactNode };

export function ReportsHub({ p, reports }: { p: Palette; reports: readonly HubReport[] }) {
  const focus = useWorkFocus();
  const [open, setOpen] = useState<string | null>(() => reports.find(r => !!focus?.anchor && !!r.anchors?.includes(focus.anchor))?.key ?? null);
  const shown = reports.find(r => r.key === open);
  if (shown) return (
    <View style={{ gap: space.section }}>
      <ToolHeader p={p} back="Reports" onBack={() => setOpen(null)} title={shown.label} detail={shown.ownIntro ? undefined : shown.detail} />
      <ToolTitled.Provider value={true}>{shown.page}</ToolTitled.Provider>
    </View>
  );
  return (
    <View style={{ gap: space.section }}>
      <PageHeading palette={p} title="Reports" subtitle="Every report on the business, each on its own page." />
      <ToolCards p={p} title="Choose a report" cards={reports} onOpen={setOpen} />
    </View>
  );
}
