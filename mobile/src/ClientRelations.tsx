import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useWorkFocus } from "./LiveKit";
import { Pills } from "./Pills";
import { ToolHeader } from "./ToolPage";
import { LicensingList } from "./LicensingList";
import { ListingHealthList, PricingList, RelistingList, ReviewsList } from "./ListingsTabs";
import { LiveEnquiries } from "./LiveEnquiries";
import { OnboardingTracker } from "./OnboardingTracker";
import { PurchaseOrdersList } from "./PurchaseOrdersList";
import { FurnishingStudio } from "./FurnishingStudio";
import { StaysRoutineCard } from "./StaysRoutineCard";
import type { SectionProps } from "./SectionProps";
import { space, ui } from "./theme";
import { CLIENT_SUB_LABEL, clientSubsFor, defaultClientSub, pickSub, type ClientSub } from "../../lib/relations-subs";

// Client relations (the owners and their properties, before and after they join): one calm strip of
// sections, one list at a time.
//   onboarding   properties moving through the onboarding stages, enquiries first (OnboardingTracker)
//   enquiries    Leads: the New Property Enquiry Form sent to landlords, their answers and each lead's ticket (LiveEnquiries)
//   licensing    licence applications (LicensingList)
//   listings     the daily listing check (ListingHealthList)
//   pricing      empty nights to price (PricingList)
//   reviews      guest reviews to log and answer (ReviewsList)
//   relisting    properties that need re-listing (RelistingList)
//   purchases    purchase orders (PurchaseOrdersList)
//   furnishing   Furnishing Studio: catalogue, client quotes, shopping lists, analytics (FurnishingStudio; Stays team and management only)
// Guest relations staff and admins see Today's routine above the chips: the listing checks and the empty
// nights to price (StaysRoutineCard, part "clients"). A link's `sub` picks the section; otherwise Onboarding opens. The host builds the SectionProps once
// and passes them in; `onOpenProperty` is where a won enquiry goes (the property's page), and `onRefresh` reloads the
// properties and journeys after an enquiry is deleted.
export function ClientRelations(props: SectionProps & { onOpenProperty: (propertyId: string) => void; onRefresh?: () => Promise<void> | void }) {
  const { palette: p, account, onOpenProperty, onRefresh } = props;
  const focus = useWorkFocus();
  const subs = clientSubsFor(account.role, account.modules);
  const [sub, setSub] = useState<ClientSub>(() => pickSub(subs, focus?.sub, defaultClientSub(subs)));
  // A link to one section opens it on its own page with "Client relations" to come back (ToolPage.tsx); opened as a
  // whole, the labelled dropdown chooses the section.
  const [alone, setAlone] = useState(() => subs.length > 1 && subs.some(s => s === focus?.sub));
  return (
    <View style={{ gap: space.section }}>
      {alone ? <ToolHeader p={p} back="Client relations" onBack={() => setAlone(false)} title={CLIENT_SUB_LABEL[sub]} /> : <>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Client relations</Text>
        <Text style={[ui.body, { color: p.muted }]}>Onboarding, leads, licensing, listings, pricing, reviews and purchases for your clients’ properties.</Text>
      </View>
      <StaysRoutineCard palette={p} account={account} properties={props.properties} work={props.work} part="clients" />
      {subs.length > 1 && <Pills p={p} title="Choose a client relations tool" showTitle values={subs} value={sub} onChange={setSub} label={v => CLIENT_SUB_LABEL[v]} />}
      </>}
      {sub === "onboarding" && <OnboardingTracker {...props} />}
      {sub === "enquiries" && <LiveEnquiries palette={p} account={account} onOpenProperty={onOpenProperty} onRefresh={onRefresh} />}
      {sub === "licensing" && <LicensingList {...props} />}
      {sub === "listings" && <ListingHealthList {...props} />}
      {sub === "pricing" && <PricingList {...props} />}
      {sub === "reviews" && <ReviewsList {...props} />}
      {sub === "relisting" && <RelistingList {...props} />}
      {sub === "purchases" && <PurchaseOrdersList {...props} />}
      {sub === "furnishing" && <FurnishingStudio p={p} account={account} />}
    </View>
  );
}
