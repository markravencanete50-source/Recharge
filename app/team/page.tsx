import { isWorkspaceAdmin } from "@/lib/modules";
import { redirect } from "next/navigation";
import { chatGPTSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessAccount, listAccessUsers } from "@/lib/access";
import { TeamClient } from "@/app/team/team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const signedInUser = await requireChatGPTUser("/team");
  const profile = await getAccessAccount(signedInUser.email, signedInUser.displayName);

  if (!profile || profile.status !== "active") redirect("/");
  if (profile.role === "client") redirect("/");

  const users = await listAccessUsers();

  return (
    <TeamClient
      users={users}
      isAdmin={isWorkspaceAdmin(profile.role)}
      currentUserName={profile.fullName || signedInUser.displayName}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
