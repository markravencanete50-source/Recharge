import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { SearchPicker } from "./SearchPicker";
import { Chip } from "./SheetTable";
import { Sheet } from "./TeamFlows";
import { Button, Field, message, Notice, Tag, useRequestId, type IconName } from "./LiveKit";
import { writeTeams } from "./backend/client";
import { DateField } from "./CalendarPicker";
import { radius, icon, ui, type Palette } from "./theme";
import {
  eventClock, eventDates, eventEdited, eventIsAllDay, TEAM_EVENT_COLOUR, TEAM_EVENT_LABEL, whoIsWhere, whoIsWhereWeek, type PersonDay, type PersonStatus, type TeamEvent, type TeamEventKind,
} from "../../lib/calendar-live";
import { TEAM_EVENT_KINDS, type RotaPlan } from "../../lib/workspace-teams-policy";
import { validClock } from "../../lib/team-time";
import { pillBox, pillInk } from "./Pills";

// Team calendar: absences, meetings, time away, training and anything else that takes a person away from
// their usual work, and where everyone is on a given day. Anyone on the team (cleaners too) adds, changes
// and cancels anyone's, and each entry shows who last edited it and when. Owners never see any of this.
// A database without migration 20261014300000 still says canEditAll only for admins, and the sheet follows it.
export const TEAM_EVENT_ICON: Record<TeamEventKind, IconName> = { absence: "user-x", meeting: "users", away: "map-pin", training: "book-open", other: "calendar" };
const PLACEHOLDER: Record<TeamEventKind, string> = { absence: "Annual leave", meeting: "Owner call", away: "Dentist", training: "First aid course", other: "Site visit" };
const eventColour = (p: Palette) => TEAM_EVENT_COLOUR[p.isDark ? "dark" : "light"];
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
const weekdayName = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const longDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayNumber = (iso: string) => String(Number(iso.slice(8)));

// One team event as a row: what it is, who it is for, when and where. `day` shows the times that fall on that day.
export function EventRow({ p, event, day, showPerson = true, first = false, onPress }: { p: Palette; event: TeamEvent; day?: string; showPerson?: boolean; first?: boolean; onPress?: () => void }) {
  const colour = eventColour(p);
  const when = day ? eventClock(event, day) ?? "All day" : eventDates(event);
  const detail = [showPerson ? (event.mine ? "You" : event.fullName ?? "Team member") : "", TEAM_EVENT_LABEL[event.kind], when, event.location || ""].filter(Boolean).join(" · ");
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${TEAM_EVENT_LABEL[event.kind]}: ${event.title}, ${detail}`} onPress={onPress} disabled={!onPress}
      style={[ui.row, { gap: 12, padding: 14, borderTopWidth: first ? 0 : 1, borderColor: p.border, alignItems: "center" }]}>
      <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: colour }} />
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: p.background, alignItems: "center", justifyContent: "center" }}><Feather name={TEAM_EVENT_ICON[event.kind]} size={16} color={colour} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{event.title}</Text>
        <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{detail}</Text>
      </View>
      {!!onPress && <Feather name="chevron-right" size={icon.row} color={p.muted} />}
    </MotionPress>
  );
}

function Line({ p, icon, label, value }: { p: Palette; icon: IconName; label: string; value: string }) {
  return (
    <View style={[ui.row, { gap: 12, paddingVertical: 2 }]}>
      <View style={{ width: 36, height: 36, borderRadius: radius.control, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon} size={16} color={p.text} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
        <Text selectable style={{ color: p.text, fontSize: 15, fontWeight: "500" }}>{value}</Text>
      </View>
    </View>
  );
}

export type TeamPerson = { userId: string; fullName: string };

// Add a team event (event = null) or look at, change or cancel one, for yourself or anyone on the team.
// When the database says you cannot change someone else's (canEditAll false), it is read only.
export function TeamEventSheet({ palette: p, visible, event, day, canEditAll, myId, people, onClose, onSaved }: {
  palette: Palette; visible: boolean; event: TeamEvent | null; day: string; canEditAll: boolean; myId: string; people: readonly TeamPerson[];
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const [kind, setKind] = useState<TeamEventKind>("absence"), [title, setTitle] = useState(""), [location, setLocation] = useState("");
  const [startsOn, setStartsOn] = useState(day), [endsOn, setEndsOn] = useState(day), [startTime, setStartTime] = useState(""), [endTime, setEndTime] = useState("");
  const [who, setWho] = useState(""), [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const editable = !event || event.mine || canEditAll;
  const edited = event ? eventEdited(event, myId) : null;
  const key = visible ? [event?.id ?? "new", event?.version ?? 0, who, kind, title, startsOn, endsOn, startTime, endTime, location].join("|") : null;
  const request = useRequestId(key), cancelRequest = useRequestId(visible && event ? "cancel:" + event.id + ":" + event.version : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !visible) return;
      setKind(event?.kind ?? "absence"); setTitle(event?.title ?? ""); setLocation(event?.location ?? "");
      setStartsOn(event?.startsOn ?? day); setEndsOn(event?.endsOn ?? day); setStartTime(event?.startTime ?? ""); setEndTime(event?.endTime ?? "");
      setWho(""); setConfirming(false); setError("");
    });
    return () => { active = false; };
  }, [visible, event, day]);
  const others = useMemo(() => people.filter(x => x.userId !== myId).map(x => ({ id: x.userId, label: x.fullName || "Team member" })), [people, myId]);

  // The same rules the database applies, so a mistake is caught before it is sent.
  function problem() {
    if (title.trim().length < 2) return "Give it a short title.";
    if (!isDay(startsOn) || !isDay(endsOn)) return "Choose the dates.";
    if (endsOn < startsOn) return "The end date must be on or after the start date.";
    if (Date.parse(endsOn) - Date.parse(startsOn) > 365 * 86400000) return "Choose up to a year.";
    if ((startTime && !validClock(startTime)) || (endTime && !validClock(endTime))) return "Enter times as HH:MM, for example 10:30.";
    if (endTime && !startTime) return "Add a start time as well as an end time.";
    if (startTime && endTime && startsOn === endsOn && endTime <= startTime) return "The end time must be after the start time.";
    return "";
  }
  async function save() {
    if (busy) return;
    const found = problem();
    if (found) { setError(found); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({
        action: "saveTeamEvent", requestId: request.get(), ...(event ? { id: event.id, version: event.version } : who ? { userId: who } : {}),
        kind, title: title.trim(), startsOn, endsOn, startTime: startTime || null, endTime: endTime || null, location: location.trim(),
      });
      request.done(); await onSaved(); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function cancel() {
    if (busy || !event) return;
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "cancelTeamEvent", requestId: cancelRequest.get(), id: event.id, version: event.version });
      cancelRequest.done(); await onSaved(); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const heading = !event ? "Add to the team calendar" : event.title;
  const subtitle = !event ? "Absences, meetings, time away and training" : `${TEAM_EVENT_LABEL[event.kind]}${event.mine ? "" : ` for ${event.fullName ?? "a team member"}`}`;
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={heading} subtitle={subtitle} icon="calendar">
      {!editable && event ? <>
        <Line p={p} icon="user" label="For" value={event.fullName ?? "Team member"} />
        <Line p={p} icon={TEAM_EVENT_ICON[event.kind]} label="What" value={TEAM_EVENT_LABEL[event.kind]} />
        <Line p={p} icon="calendar" label="When" value={eventDates(event)} />
        {!!event.startTime && <Line p={p} icon="clock" label="Time (UK)" value={event.endTime ? `${event.startTime} to ${event.endTime}` : `From ${event.startTime}`} />}
        {!!event.location && <Line p={p} icon="map-pin" label="Where" value={event.location} />}
        {!!edited && <Line p={p} icon="edit-3" label={edited.label} value={`${edited.who} · ${edited.when}`} />}
        <Text style={[ui.small, { color: p.muted }]}>Only {event.fullName ?? "this person"} or an admin can change this.</Text>
      </> : <>
        {canEditAll && !event && (
          <View style={{ gap: 8 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Who is it for?</Text>
            <SearchPicker p={p} value={who} onChange={setWho} fixed={[{ id: "", label: "Me" }]} options={others} placeholder="Search the team by name" nouns="people" />
          </View>
        )}
        {!!event && !event.mine && <Line p={p} icon="user" label="For" value={event.fullName ?? "Team member"} />}
        {!!edited && <Line p={p} icon="edit-3" label={edited.label} value={`${edited.who} · ${edited.when}`} />}
        <View style={{ gap: 8 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>What is it?</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TEAM_EVENT_KINDS.map(k => <Chip key={k} p={p} label={TEAM_EVENT_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}
          </View>
        </View>
        <Field label="Title" value={title} onChange={setTitle} p={p} placeholder={PLACEHOLDER[kind]} />
        <DateField p={p} label="Dates" hint="Choose the first day, then the last. For one day, choose it twice." wholeMonthLink={false} value={{ from: startsOn, to: endsOn }} onChange={next => { setStartsOn(next.from); setEndsOn(next.to); }} />
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 140 }}><Field label="Starts (HH:MM, optional)" value={startTime} onChange={setStartTime} p={p} placeholder="10:00" /></View>
          <View style={{ flex: 1, minWidth: 140 }}><Field label="Ends (optional)" value={endTime} onChange={setEndTime} p={p} placeholder="11:30" /></View>
        </View>
        <Text style={[ui.small, { color: p.muted }]}>UK time. Leave the times empty for the whole day.</Text>
        <Field label="Where (optional)" value={location} onChange={setLocation} p={p} placeholder="Office" />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : event ? "Save changes" : "Add to the calendar"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
        {!!event && !confirming && <Button label="Cancel this event" icon="x" p={p} disabled={busy} onPress={() => setConfirming(true)} />}
        {!!event && confirming && (
          <View style={{ gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: p.border }}>
            <Text style={{ color: p.text, fontSize: 14 }}>{event.mine ? "Cancel this event? It disappears from the team calendar." : `Cancel this for ${event.fullName ?? "them"}? They are told, and it disappears from the team calendar.`}</Text>
            <Button label={busy ? "Cancelling…" : "Yes, cancel it"} icon="trash-2" primary p={p} disabled={busy} onPress={() => void cancel()} />
            <Button label="Keep it" p={p} disabled={busy} onPress={() => setConfirming(false)} />
          </View>
        )}
      </>}
      {!editable && !!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

const STATUS_TONE: Record<PersonStatus, "good" | "wait" | "bad" | "plain"> = { working: "good", away: "wait", off: "plain", unplanned: "plain" };
const STATUS_HEAD: Record<PersonStatus, string> = { working: "Working", away: "Away", off: "Off", unplanned: "Not on the rota" };
const SHORT: Record<string, string> = { early: "E", late: "L", both: "E+L", off: "Off" };
// The mark in a week strip: the shift (E, L, E+L), Off, or Away when an absence fills the day.
const cellMark = (c: PersonDay) => c.status === "away" ? "Away" : c.status === "off" ? "Off" : c.shift ? SHORT[c.shift] : "-";

// Who is where: pick a day of the week for the list of everyone on it (working, away, off), then the
// whole week as one row per person. Tapping an event opens it.
export function WhoIsWhere({ p, rota, events, days, day, today, myId, loading, personId, onDay, onOpenEvent }: {
  p: Palette; rota: Pick<RotaPlan, "people"> | null; events: readonly TeamEvent[]; days: readonly string[]; day: string; today: string; myId: string; loading: boolean;
  personId: string | null; onDay: (day: string) => void; onOpenEvent: (e: TeamEvent) => void;
}) {
  const colour = eventColour(p);
  const list = useMemo(() => whoIsWhere(day, rota, events).filter(x => !personId || x.userId === personId), [day, rota, events, personId]);
  const week = useMemo(() => whoIsWhereWeek(days, rota, events).filter(x => !personId || x.userId === personId), [days, rota, events, personId]);
  const groups = (["working", "away", "off", "unplanned"] as PersonStatus[]).map(s => [s, list.filter(x => x.status === s)] as const).filter(([, items]) => items.length);
  const name = (x: { userId: string; fullName: string }) => x.userId === myId ? "You" : x.fullName || "Team member";
  return (
    <View style={{ gap: 16 }}>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6 }}>
        {days.map(d => {
          const on = d === day;
          return (
            <MotionPress key={d} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={longDay(d) + (d === today ? ", today" : "")} onPress={() => onDay(d)}
              style={{ flex: 1, minWidth: 0, minHeight: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 2, ...pillBox(p, on) }}>
              <Text style={{ color: pillInk(p, on, true), fontSize: 11, fontWeight: "500" }}>{weekdayName(d)}</Text>
              <Text style={{ color: pillInk(p, on), fontSize: 15, fontWeight: d === today ? "600" : "500", fontVariant: ["tabular-nums"] }}>{dayNumber(d)}</Text>
            </MotionPress>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "600" }}>{day === today ? "Today" : longDay(day)}</Text>
        {!list.length ? (
          <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
            <Feather name="users" size={16} color={p.muted} />
            <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{loading ? "Loading the team…" : "No one is planned for this day yet."}</Text>
          </View>
        ) : groups.map(([status, items]) => (
          <View key={status} style={{ gap: 6 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{STATUS_HEAD[status]} · {items.length}</Text>
            <View style={{ borderRadius: radius.card, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
              {items.map((x, i) => (
                <View key={x.userId} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
                  <View style={[ui.row, { gap: 12, padding: 14, alignItems: "center" }]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{name(x)}</Text>
                      <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{x.label}{x.status === "away" && x.shift && x.shift !== "off" ? ` (rota: ${x.shift})` : ""}</Text>
                    </View>
                    <Tag label={status === "away" ? "Away" : status === "working" ? "In" : status === "off" ? "Off" : "No shift"} tone={STATUS_TONE[status]} p={p} />
                  </View>
                  {x.events.filter(e => !(status === "away" && (e.kind === "absence" || e.kind === "away") && eventIsAllDay(e, day))).map(e => (
                    <EventRow key={e.id} p={p} event={e} day={day} showPerson={false} onPress={() => onOpenEvent(e)} />
                  ))}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {!!week.length && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "600" }}>This week</Text>
          <View style={{ borderRadius: radius.card, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
            {week.map((row, i) => (
              <View key={row.userId} style={{ gap: 8, padding: 14, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{name(row)}</Text>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {row.days.map((c, n) => {
                    const d = days[n], busy = c.events.length > 0;
                    return (
                      <MotionPress key={d} accessibilityRole="button" accessibilityLabel={`${name(row)}, ${longDay(d)}: ${c.label}${busy ? `, ${c.events.map(e => e.title).join(", ")}` : ""}`} onPress={() => onDay(d)}
                        style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 1, borderColor: d === day ? p.primary : p.border,
                          backgroundColor: c.status === "away" ? p.cautionWash : c.status === "working" ? p.successWash : "transparent" }}>
                        <Text style={{ color: p.muted, fontSize: 10 }}>{weekdayName(d).slice(0, 2)}</Text>
                        <Text style={{ color: c.status === "away" ? p.waiting : c.status === "working" ? p.success : p.muted, fontSize: 12, fontWeight: "600" }}>{cellMark(c)}</Text>
                        {busy && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colour }} />}
                      </MotionPress>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
          <Text style={[ui.small, { color: p.muted }]}>E is early (8am to 4pm), L is late (3pm to 11pm). A dot means a meeting, training or another team event that day.</Text>
        </View>
      )}
    </View>
  );
}
