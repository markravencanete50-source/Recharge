import { redirect } from 'next/navigation';
import { verifiedWorkspaceUser,workspaceSupabase } from '../../lib/supabase-server';
import { workspaceAccountSchema } from '../../lib/workspace-account-policy';
import { LiveWorkspace } from './workspace-client';
import { AccountRegistration } from './account-registration';
import './workspace.css';
export const dynamic='force-dynamic';
export default async function Workspace(){
 const user=await verifiedWorkspaceUser();
 if(!user)redirect('/sign-in');
 const client=await workspaceSupabase();
 const result=await client?.rpc('workspace_account');
 const parsed=workspaceAccountSchema.safeParse(result?.data);
 if(result?.error)return <main className="live-workspace"><h1>Workspace temporarily unavailable</h1><p>Please try again shortly.</p><a href="/sign-in">Return to sign in</a></main>;
 // Signed in without active access: ask for access, or show where the request stands.
 if(!parsed.success||parsed.data.status!=='active')return <AccountRegistration email={user.email||''} suggestedName={String(user.user_metadata?.full_name||'')} signOutPath="/sign-out" existingRequest={parsed.success?{role:parsed.data.role,status:parsed.data.status}:null}/>;
 return <LiveWorkspace account={parsed.data}/>;
}
