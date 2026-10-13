import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { ChoicePills } from "./ChoiceField";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { Button, Loading, Notice, useRequestId } from "./LiveKit";
import { liveNavigationFor } from "./NavigationBar";
import { readTeams, writeTeams } from "./backend/client";
import { publishMenuLayout } from "./MenuLayoutStore";
import { DEFAULT_ROLE_MODULES } from "../../lib/modules";
import { rolePanel, type RolePanel } from "../../lib/role-panel";
import {
  MENU_ROLES, MENU_ROLE_LABEL, isLocked, layoutOfPanel, moveItem, moveItemTo, moveSection, orderPhoneBar, parseMenuLayout, phoneMoreGroups, storedMenuLayoutSchema,
  type MenuRole, type StoredMenuLayout,
} from "../../lib/menu-layout";

// Access control → Menu order (super admins). Pick a role, move its sections and the links inside each
// section up or down, or move a link to another section ("Move to section"), then "Save and publish": everyone with that role gets the new order on their next quiet
// refresh (within a minute), and this app at once. It only reorders; what a role may open is unchanged.
// The preview is built by the same code the app uses (rolePanel with the layout, then the phone bar order),
// shown with the role's usual tools.
const message = (e: unknown) => e instanceof Error ? e.message : "That did not work. Try again.";
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
const same = (a: RolePanel, b: RolePanel) => JSON.stringify(layoutOfPanel(a)) === JSON.stringify(layoutOfPanel(b));

// A plain up or down button, 44 points square, that works with a keyboard and a screen reader.
function Move({ p, label, icon, disabled, onPress }: { p: Palette; label: string; icon: "chevron-up" | "chevron-down"; disabled: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, opacity: disabled ? 0.35 : 1 }}>
      <Feather name={icon} size={18} color={p.text} />
    </MotionPress>
  );
}

export function MenuOrderEditor({ palette: p }: { palette: Palette }) {
  const [role, setRole] = useState<MenuRole>("stays");
  const [stored, setStored] = useState<StoredMenuLayout[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  // The role's menu as saved (with its usual tools), and the one being edited. The draft is kept with the
  // saved version it started from, so switching role or a new save starts again from what is saved.
  const current = stored.find(l => l.role === role) ?? null;
  // The editor keeps sections a move has emptied (the app hides them), so links can be moved back.
  const savedPanel = useMemo(() => rolePanel(role, DEFAULT_ROLE_MODULES[role], parseMenuLayout(current), true), [role, current]);
  // The link whose "Move to section" choices are open.
  const [moving, setMoving] = useState<string | null>(null);
  const savedKey = role + ":" + (current?.version ?? 0);
  const [edit, setEdit] = useState<{ key: string; panel: RolePanel } | null>(null);
  const draft = edit && edit.key === savedKey ? edit.panel : savedPanel;
  const setDraft = (next: (d: RolePanel) => RolePanel) => setEdit({ key: savedKey, panel: next(draft) });
  const load = useCallback(async () => {
    setError("");
    try { setStored(z.array(storedMenuLayoutSchema).parse((await readTeams({ section: "menuLayouts" })).data)); }
    catch (e) { setError(message(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const request = useRequestId(["menu", role, current?.version ?? 0, JSON.stringify(layoutOfPanel(draft))].join(":"));

  // What the role will see, through the same merge as the app.
  const preview = useMemo(() => rolePanel(role, DEFAULT_ROLE_MODULES[role], layoutOfPanel(draft)), [role, draft]);
  const bar = useMemo(() => orderPhoneBar(liveNavigationFor(role), preview), [role, preview]);
  const changed = !same(draft, savedPanel);

  async function send(action: "saveMenuLayout" | "resetMenuLayout") {
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      const input = action === "saveMenuLayout"
        ? { action, requestId: request.get(action), role, version: current?.version ?? 0, ...layoutOfPanel(draft) } as const
        : { action, requestId: request.get(action), role, version: current?.version ?? 0 } as const;
      const saved = storedMenuLayoutSchema.parse((await writeTeams(input)).data);
      request.done(action);
      setStored(list => [...list.filter(l => l.role !== role), saved]);
      publishMenuLayout(role, parseMenuLayout(saved));
      setNote(action === "saveMenuLayout" ? `Published. Everyone with the ${MENU_ROLE_LABEL[role]} role gets this order within a minute.` : `${MENU_ROLE_LABEL[role]} is back to the default order.`);
    } catch (e) { setError(message(e)); if (/Changed by someone else/.test(message(e))) void load(); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading p={p} />;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Menu order</Text>
        <Text style={[ui.small, { color: p.muted }]}>The order of the left panel and the phone menu for each role. Move the sections, the links inside a section, or a link to another section. This only arranges the menu: what each person can open still comes from their role and tools.</Text>
      </View>
      <ChoicePills p={p} name="Role" values={MENU_ROLES} value={role} onChange={value => { setRole(value); setMoving(null); setNote(""); setError(""); }} label={v => MENU_ROLE_LABEL[v]} />
      <Text style={[ui.small, { color: p.muted }]}>{current?.updatedAt ? `Last changed by ${current.updatedByName ?? "a super admin"} on ${when(current.updatedAt)}.` : "Default order. Nobody has changed it yet."}</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!note && <Notice text={note} p={p} />}
      <View style={{ gap: 12 }}>
        {draft.groups.map((group, gi) => (
          <View key={group.key} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8 }]}>
            <View style={[ui.row, { gap: 8 }]}>
              <Text accessibilityRole="header" style={{ flex: 1, color: p.text, fontSize: 15, fontWeight: "600" }}>{gi + 1}. {group.title}</Text>
              <Move p={p} icon="chevron-up" label={`Move section ${group.title} up`} disabled={gi === 0 || busy} onPress={() => setDraft(d => moveSection(d, group.key, -1))} />
              <Move p={p} icon="chevron-down" label={`Move section ${group.title} down`} disabled={gi === draft.groups.length - 1 || busy} onPress={() => setDraft(d => moveSection(d, group.key, 1))} />
            </View>
            {!group.links.length && <Text style={[ui.small, { color: p.muted, paddingLeft: 12 }]}>Empty: hidden for this role until a link is moved here.</Text>}
            {group.links.map((link, li) => (
              <View key={link.key} style={{ gap: 6, paddingLeft: 12, borderTopWidth: 1, borderColor: p.border, paddingTop: 6 }}>
                <View style={[ui.row, { gap: 8 }]}>
                  <Feather name={link.icon as keyof typeof Feather.glyphMap} size={15} color={p.muted} />
                  <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14 }}>{link.label}</Text>
                  <Move p={p} icon="chevron-up" label={`Move ${link.label} up in ${group.title}`} disabled={li === 0 || busy} onPress={() => setDraft(d => moveItem(d, group.key, link.key, -1))} />
                  <Move p={p} icon="chevron-down" label={`Move ${link.label} down in ${group.title}`} disabled={li === group.links.length - 1 || busy} onPress={() => setDraft(d => moveItem(d, group.key, link.key, 1))} />
                  {isLocked(link.key) ? <Feather name="lock" size={15} color={p.muted} accessibilityLabel={`${link.label} stays in ${group.title}`} /> : <MotionPress accessibilityRole="button" accessibilityLabel={`Move ${link.label} to another section`} accessibilityState={{ expanded: moving === link.key, disabled: busy }} disabled={busy}
                    onPress={() => setMoving(moving === link.key ? null : link.key)}
                    style={{ minHeight: 44, paddingHorizontal: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: moving === link.key ? p.wash : p.surface }}>
                    <Text style={{ color: p.text, fontSize: 13 }}>Move to…</Text>
                  </MotionPress>}
                </View>
                {isLocked(link.key) && <Text style={[ui.small, { color: p.muted }]}>Favorites stays in {group.title} for every role, so it is always easy to reach. It can move up or down here.</Text>}
                {moving === link.key && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 6 }}>
                    {draft.groups.filter(g => g.key !== group.key).map(g => (
                      <MotionPress key={g.key} accessibilityRole="button" accessibilityLabel={`Move ${link.label} to ${g.title}`} onPress={() => { setDraft(d => moveItemTo(d, link.key, g.key)); setMoving(null); }}
                        style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
                        <Text style={{ color: p.text, fontSize: 13 }}>{g.title}</Text>
                      </MotionPress>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label={busy ? "Saving…" : "Save and publish"} icon="check" primary p={p} disabled={busy || !changed} onPress={() => void send("saveMenuLayout")} />
        {changed && <Button label="Undo changes" icon="rotate-ccw" p={p} disabled={busy} onPress={() => setEdit(null)} />}
        <Button label="Reset this role to default" icon="refresh-ccw" p={p} disabled={busy || (!current?.sections.length && !Object.keys(current?.items ?? {}).length)} onPress={() => void send("resetMenuLayout")} />
      </View>
      <View style={[ui.card, { backgroundColor: p.wash, borderColor: p.border, gap: 10 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>Preview: what {MENU_ROLE_LABEL[role]} will see</Text>
        <Text style={[ui.small, { color: p.muted }]}>{"Shown with the role's usual tools; a person with fewer tools sees fewer links, in this order."}</Text>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Phone bar</Text>
        <Text style={{ color: p.text, fontSize: 14 }}>{bar.map(b => b.label).join("  ·  ")}</Text>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{"Left panel (desktop), and the phone's Menu without the bar's places"}</Text>
        {preview.groups.map(group => (
          <View key={group.key} style={{ gap: 2 }}>
            <Text style={[ui.label, { color: p.muted }]}>{group.title}</Text>
            <Text style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{group.links.map(l => l.label).join(", ")}</Text>
          </View>
        ))}
        <Text style={[ui.small, { color: p.muted }]}>Phone menu sections: {phoneMoreGroups(preview, bar).map(g => g.title).join(", ") || "none"}</Text>
      </View>
    </View>
  );
}
