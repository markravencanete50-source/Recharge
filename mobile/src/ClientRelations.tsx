import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useWorkFocus } from "./LiveKit";
import { Pills } from "./Pills";
import { LicensingList } from "./LicensingList";
import { ListingHealthList, PricingList, RelistingList, ReviewsList } from "./ListingsTabs";
import { LiveEnquiries } from "./LiveEnquiries";
import { OnboardingTracker } from "./OnboardingTracker";
import { PurchaseOrdersList } from "./PurchaseOrdersList";
import { StaysRoutineCard } from "./StaysRoutineCard";
import type { SectionProps } from "./SectionProps";
import { space, ui } from "./theme";
import { CLIENT_SUB_LABEL, clientSubsFor, defaultClientSub, pickSub, type ClientSub } from "../../lib/relations-subs";

// Client relations (the owners and their properties, before and after they join): one calm strip of
// sections, one list at a time.
//   onboarding   properties moving through the onboarding stages, enquiries first (OnboardingTracker)
//   enquiries    the New Property Enquiry Form sent to landlords and their answers (LiveEnquiries)
//   licensing    licence applications (LicensingList)
//   listings     the daily listing check (ListingHealthList)
//   pricing      empty nights to price (PricingList)
//   reviews      guest reviews to log and answer (ReviewsList)
//   relisting    properties that need re-listing (RelistingList)
//   purchases    purchase orders (PurchaseOrdersList)
// Guest relations staff and admins see Today's routine above the chips: the listing checks and the empty
// nights to price (StaysRoutineCard, part "clients"). A link's `sub` picks the section; otherwise Onboarding opens. The host builds the SectionProps once
// and passes them in; `onOpenProperty` is where a won enquiry goes (the property's page), and `onRefresh` reloads the
// properties and journeys after an enquiry is deleted.
export function ClientRelations(props: SectionProps & { onOpenProperty: (propertyId: string) => void; onRefresh?: () => Promise<void> | void }) {
  const { palette: p, account, onOpenProperty, onRefresh } = props;
  const focus = useWorkFocus();
  const subs = clientSubsFor(account.role, account.modules);
  const [sub, setSub] = useState<ClientSub>(() => pickSub(subs, focus?.sub, defaultClientSub(subs)));
  return (
    <View style={{ gap: space.section }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Client relations</Text>
        <Text style={[ui.body, { color: p.muted }]}>Onboarding, enquiries, licensing, listings, pricing, reviews and purchases for your clients’ properties.</Text>
      </View>
      <StaysRoutineCard palette={p} account={account} properties={props.properties} work={props.work} part="clients" />
      {subs.length > 1 && <Pills p={p} title="Client relations section" values={subs} value={sub} onChange={setSub} label={v => CLIENT_SUB_LABEL[v]} />}
      {sub === "onboarding" && <OnboardingTracker {...props} />}
      {sub === "enquiries" && <LiveEnquiries palette={p} account={account} onOpenProperty={onOpenProperty} onRefresh={onRefresh} />}
      {sub === "licensing" && <LicensingList {...props} />}
      {sub === "listings" && <ListingHealthList {...props} />}
      {sub === "pricing" && <PricingList {...props} />}
      {sub === "reviews" && <ReviewsList {...props} />}
      {sub === "relisting" && <RelistingList {...props} />}
      {sub === "purchases" && <PurchaseOrdersList {...props} />}
    </View>
  );
}
