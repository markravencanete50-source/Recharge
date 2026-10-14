import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { Button, useWorkFocus } from "./LiveKit";
import { Pills } from "./Pills";
import { AirCoverList } from "./AirCoverList";
import { DirectBookings } from "./DirectBookings";
import { LiveCleans } from "./LiveCleans";
import { LiveRepairs } from "./LiveRepairs";
import { PreventativeList } from "./PreventativeList";
import { StaySheet } from "./StaySheet";
import { StaysRoutineCard } from "./StaysRoutineCard";
import type { SectionProps } from "./SectionProps";
import { ui } from "./theme";
import { canStart } from "../../lib/home-tools";
import { GUEST_SUB_LABEL, defaultGuestSub, guestSubsFor, pickSub, type GuestSub } from "../../lib/relations-subs";

// Guest relations (the Work area that used to be Stays): one calm strip of sections, one list at a time.
//   cleans        the changeover cleans (LiveCleans)
//   bookings      direct-booking follow-ups (DirectBookings)
//   aircover      AirCover claims (AirCoverList)
//   reactive      repairs from report to completion (LiveRepairs)
//   preventative  routine visits (PreventativeList)
// A link's `sub` picks the section (Work → Guest relations → AirCover opens it); otherwise the role's own
// first section opens. Guest relations staff and admins see Today's routine above the chips (StaysRoutineCard);
// its listing checks and empty-night pricing are on Client relations instead.
// "Record a stay" sits in the header, and a link with `open: "record-stay"` opens it.
// The host builds the SectionProps once and passes them in; `onRefresh` asks it to read the work list
// again after a stay is recorded.
export function GuestRelations(props: SectionProps & { onRefresh?: () => void | Promise<void>; minimumNights?: number }) {
  const { palette: p, account, properties, onRefresh, minimumNights } = props;
  const focus = useWorkFocus();
  const saved = useSaved();
  const subs = guestSubsFor(account.role, account.modules);
  const [sub, setSub] = useState<GuestSub>(() => pickSub(subs, focus?.sub, defaultGuestSub(account.role, subs)));
  const [recording, setRecording] = useState(() => focus?.open === "record-stay" && canStart(account, "record-stay"));
  return (
    <View style={{ gap: 16 }}>
      {/* The title keeps its width; on a phone "Record a stay" wraps under it instead of squeezing it. */}
      <View style={[ui.between, { gap: 12, alignItems: "flex-start", flexWrap: "wrap" }]}>
        <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Guest relations</Text>
          <Text style={[ui.body, { color: p.muted }]}>Cleans, direct bookings, AirCover claims and repairs for your guests’ stays.</Text>
        </View>
        {canStart(account, "record-stay") && <Button label="Record a stay" icon="plus" primary p={p} onPress={() => setRecording(true)} />}
      </View>
      <StaysRoutineCard palette={p} account={account} properties={properties} work={props.work} part="guests" />
      {subs.length > 1 && <Pills p={p} values={subs} value={sub} onChange={setSub} label={v => GUEST_SUB_LABEL[v]} wrap={false} />}
      {sub === "cleans" && <LiveCleans palette={p} account={account} properties={properties} onForm={props.onForm} />}
      {sub === "bookings" && <DirectBookings {...props} />}
      {sub === "aircover" && <AirCoverList {...props} />}
      {sub === "reactive" && <LiveRepairs palette={p} account={account} properties={properties} showRoutines={false} />}
      {sub === "preventative" && <PreventativeList {...props} />}
      <StaySheet p={p} visible={recording} properties={properties} minimumNights={minimumNights} onClose={() => setRecording(false)} onDone={saved(async () => { await onRefresh?.(); })} />
    </View>
  );
}
