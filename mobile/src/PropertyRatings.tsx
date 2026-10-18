import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { MotionPress } from "./motion";
import { Loading, london, message, Notice, Section, StatGrid, StatTile } from "./LiveKit";
import { AnalyticsPanel, PeriodBar, usePeriod } from "./AnalyticsKit";
import { ratingsModel } from "../../lib/report-analytics-models";
import { STANDARD_PERIODS } from "../../lib/report-analytics";
import { List, Row } from "./AccountsPayable";
import { Pills } from "./Pills";
import { SearchBox } from "./SearchPicker";
import { useToolTitled } from "./ToolPage";
import { readTeams, WorkspaceApiError } from "./backend/client";
import { isWorkspaceAdmin } from "../../lib/modules";
import {
  RATING_SORTS, RATING_SORT_LABEL, RATINGS_INTRO, RATINGS_SECTION, emptyRatingsLine, propertyRatingsSchema, ratingChannelName, recentLine, reviewByLine,
  reviewRatingLine, sortRatings, sourceLine, starsLine, starsValue, syncLine, type PropertyRatings, type RatingReview, type RatingSort,
} from "../../lib/property-ratings";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Property ratings (Lee: "Can we get the ratings for each property?", migration 20261022500000). Guest review ratings from
// Hostaway, with the reviews the team logs, worked out by the database (workspace_property_ratings), which also decides who
// sees which properties: admins, super admins and Guest relations every property, the rest of the team the properties
// they are assigned to, owners none for now. Stars are out of 5.

async function readRatings(propertyId?: string) {
  return propertyRatingsSchema.parse((await readTeams(propertyId ? { section: RATINGS_SECTION, propertyId } : { section: RATINGS_SECTION })).data);
}

// One property's ratings, loaded on its own: the latest answer only, so a quick change of property never shows the last one.
function usePropertyRatings(propertyId: string | null) {
  const [data, setData] = useState<{ id: string; value: PropertyRatings } | null>(null);
  const [error, setError] = useState(""), [denied, setDenied] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!propertyId) return;
    const mine = ++latest.current;
    setError(""); setDenied(false);
    try { const value = await readRatings(propertyId); if (mine === latest.current) setData({ id: propertyId, value }); }
    catch (e) { if (mine === latest.current) { setError(message(e)); setDenied(e instanceof WorkspaceApiError && e.status === 403); } }
  }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  return { data: data && data.id === propertyId ? data.value : null, error, denied, retry: load };
}

function ReviewRow({ p, review, first }: { p: Palette; review: RatingReview; first: boolean }) {
  return (
    <View style={{ gap: 4, paddingTop: first ? 0 : 12, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{reviewRatingLine(review)}</Text>
        {!!review.url && <MotionPress accessibilityRole="link" accessibilityLabel={"Open the review on " + ratingChannelName(review.channel)} onPress={() => void Linking.openURL(review.url ?? "").catch(() => undefined)} style={{ minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" }}><Feather name="external-link" size={16} color={p.primary} /></MotionPress>}
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{reviewByLine(review)}</Text>
      <Text selectable numberOfLines={6} style={[ui.body, { color: p.text }]}>{review.text}</Text>
    </View>
  );
}

// The latest reviews with words, newest first.
export function LatestReviews({ p, reviews }: { p: Palette; reviews: readonly RatingReview[] }) {
  if (!reviews.length) return <Text style={[ui.small, { color: p.muted }]}>No written reviews yet.</Text>;
  return <View style={{ gap: 12 }}>{reviews.map((r, i) => <ReviewRow key={`${r.source}:${r.reviewedOn}:${i}`} p={p} review={r} first={i === 0} />)}</View>;
}

// On a property's page (team view): "4.8 stars from 132 reviews", the last 90 days, and the latest few reviews.
export function PropertyRatingsSummary({ p, propertyId }: { p: Palette; propertyId: string }) {
  const { data, error, denied } = usePropertyRatings(propertyId);
  // Someone who can open the property without being assigned to it (Accounts, say) is not shown its ratings.
  if (denied) return <Text style={[ui.small, { color: p.muted }]}>Ratings are shown to Guest relations, admins and the team assigned to this property.</Text>;
  if (error) return <Text style={[ui.small, { color: p.muted }]}>Ratings could not be loaded.</Text>;
  if (!data) return <Loading p={p} rows={1} />;
  const r = data.properties[0];
  if (!r) return <Text style={[ui.small, { color: p.muted }]}>Ratings could not be loaded.</Text>;
  if (!r.reviews) return <Text style={[ui.small, { color: p.muted }]}>{emptyRatingsLine(data, r)}</Text>;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{starsLine(r.average, r.reviews)}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{[recentLine(r), sourceLine(r)].filter(Boolean).join(" · ")}</Text>
      </View>
      <LatestReviews p={p} reviews={(data.property?.latest ?? []).slice(0, 3)} />
    </View>
  );
}

// One property in full, inside the Ratings report.
function RatingsDetail({ p, propertyId, name, onBack }: { p: Palette; propertyId: string; name: string; onBack: () => void }) {
  const { data, error, retry } = usePropertyRatings(propertyId);
  const r = data?.properties[0];
  return (
    <View style={{ gap: 16 }}>
      <MotionPress accessibilityRole="button" onPress={onBack} style={[ui.row, { gap: 6, alignSelf: "flex-start", minHeight: 44 }]}>
        <Feather name="chevron-left" size={18} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>All properties</Text>
      </MotionPress>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{name}</Text>
      {!!error && <View style={{ gap: 8 }}><Notice text={error} p={p} tone="bad" /><MotionPress accessibilityRole="button" onPress={() => void retry()} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}><Text style={{ color: p.primary, fontWeight: "600" }}>Try again</Text></MotionPress></View>}
      {!data && !error && <Loading p={p} />}
      {data && r && (r.reviews ? <>
        <StatGrid showZeros>
          <StatTile p={p} icon="star" label="Average rating" value={`${starsValue(r.average)} of 5`} detail={starsLine(r.average, r.reviews)} />
          <StatTile p={p} icon="clock" label="Last 90 days" value={r.recentReviews ? `${starsValue(r.recentAverage)} of 5` : "None"} detail={recentLine(r)} />
        </StatGrid>
        {!!sourceLine(r) && <Text style={[ui.small, { color: p.muted }]}>{sourceLine(r)}</Text>}
        {!!data.property?.channels.length && <Section title="By channel" count={data.property.channels.length} p={p}>
          <List p={p} empty="" search={false}>
            {data.property.channels.map((c, i) => <Row key={c.channel} p={p} first={i === 0} title={ratingChannelName(c.channel)} detail={starsLine(c.average, c.reviews)} amount={starsValue(c.average) ?? "–"} />)}
          </List>
        </Section>}
        <Section title="Latest reviews" p={p}>
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}><LatestReviews p={p} reviews={data.property?.latest ?? []} /></View>
        </Section>
      </> : <Notice p={p} text={emptyRatingsLine(data, r)} />)}
    </View>
  );
}

// Reports > Ratings (admins and super admins; the hub is theirs). Every property with its average stars, number of reviews
// and the last 90 days' average, lowest first so problems surface, with a search; tap a property for its reviews.
export function RatingsReport({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const allowed = isWorkspaceAdmin(account.role), titled = useToolTitled();
  const [data, setData] = useState<PropertyRatings | null>(null);
  const [error, setError] = useState(""), [sort, setSort] = useState<RatingSort>("lowest"), [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  // The analytics: the last 90 days against the 90 before to start, worked out from the same answer (no second read).
  const period = usePeriod(STANDARD_PERIODS, "90d", london(new Date()));
  const model = useMemo(() => (data ? ratingsModel(data, period.range, period.previous, period.against) : null), [data, period.range, period.previous, period.against]);
  const load = useCallback(async () => {
    setError("");
    try { setData(await readRatings()); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);
  if (!allowed) return null;
  if (open) return <RatingsDetail p={p} propertyId={open.id} name={open.name} onBack={() => setOpen(null)} />;
  const rows = data ? sortRatings(data.properties, sort, query) : [];
  const rated = data?.properties.filter(r => r.reviews) ?? [];
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        {!titled && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Ratings</Text>}
        <Text style={[ui.small, { color: p.muted }]}>{RATINGS_INTRO}</Text>
      </View>
      {!!error && <View style={{ gap: 8 }}><Notice text={error} p={p} tone="bad" /><MotionPress accessibilityRole="button" onPress={() => void load()} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}><Text style={{ color: p.primary, fontWeight: "600" }}>Try again</Text></MotionPress></View>}
      {!data && !error && <Loading p={p} />}
      {data && <>
        <Text style={[ui.small, { color: p.muted }]}>{syncLine(data.sync)}</Text>
        <AnalyticsPanel p={p} model={model} controls={<PeriodBar p={p} period={period} />} caption={`${period.label}, ${period.against}.`} />
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Every property</Text>
        {!rated.length && <Notice p={p} text={data.properties.length ? emptyRatingsLine(data) : "No properties to show yet."} />}
        {!!data.properties.length && <View style={{ gap: 10 }}>
          <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search properties by name" />
          <Pills p={p} title="Sort" values={RATING_SORTS} value={sort} onChange={setSort} label={s => RATING_SORT_LABEL[s]} />
        </View>}
        {!!data.properties.length && <List p={p} empty={query.trim() ? "No property matches that search." : "No properties to show yet."} search={false}>
          {rows.map((r, i) => <Row key={r.propertyId} p={p} first={i === 0} title={r.propertyName}
            detail={r.reviews ? `${starsLine(r.average, r.reviews)} · ${recentLine(r)}` : emptyRatingsLine(data, r)}
            amount={starsValue(r.average) ?? "–"} onPress={() => setOpen({ id: r.propertyId, name: r.propertyName })} />)}
        </List>}
      </>}
    </View>
  );
}
