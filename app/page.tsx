import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { RechargePortal } from "@/app/recharge-portal";
import { AccountRegistration } from "@/app/account-registration";
import {
  getAccessAccount,
  listAccessUsers,
} from "@/lib/access";
import { getMyRechargeData } from "@/lib/my-recharge";
import { getWorkflowData } from "@/lib/workflows";
import { getCommunicationCentreData } from "@/lib/communications";
import { getMaintenanceData } from "@/lib/maintenance";
import { getPropertyDatabaseData } from "@/lib/property-database";
import { getOnboardingData } from "@/lib/onboarding";
import { getCleansData } from "@/lib/cleans";
import { scopeAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const account = await getAccessAccount(user.email, user.displayName);

  if (!account || account.status !== "active") {
    return (
      <AccountRegistration
        email={user.email}
        suggestedName={user.displayName}
        signOutPath={chatGPTSignOutPath("/")}
        existingRequest={account}
      />
    );
  }

  const profile = account;

  // These datasets are independent. Loading them together keeps navigation
  // interactive instead of making the user wait for every department in turn.
  const [
    accessUsers,
    myRecharge,
    workflowData,
    communicationData,
    maintenanceData,
    propertyDatabaseData,
    onboardingData,
    cleansData,
  ] = await Promise.all([
    profile.role === "client" ? Promise.resolve([]) : listAccessUsers(),
    profile.role === "stays"
      ? getMyRechargeData(profile.email)
      : Promise.resolve(undefined),
    profile.role === "client"
      ? Promise.resolve(undefined)
      : getWorkflowData(profile),
    profile.role === "client"
      ? Promise.resolve(undefined)
      : getCommunicationCentreData(profile),
    getMaintenanceData(profile),
    getPropertyDatabaseData(profile),
    getOnboardingData(profile),
    getCleansData(profile),
  ]);

  return (
    <RechargePortal
      currentUser={{
        name: profile.fullName || user.displayName,
        email: user.email,
        role: profile.role,
        modules: profile.modules,
      }}
      accessUsers={accessUsers}
      myRecharge={myRecharge}
      workflowData={workflowData}
      communicationData={communicationData}
      maintenanceData={maintenanceData}
      propertyDatabaseData={propertyDatabaseData}
      onboardingData={onboardingData}
      cleansData={cleansData}
      analyticsData={scopeAnalytics(profile, { workflows: workflowData, maintenance: maintenanceData, cleans: cleansData, onboarding: onboardingData, properties: propertyDatabaseData })}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
