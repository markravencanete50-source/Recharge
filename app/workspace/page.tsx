import { redirect } from 'next/navigation';
import { verifiedWorkspaceUser,workspaceSupabase } from '../../lib/supabase-server';
import { workspaceAccountSchema } from '../../lib/workspace-account-policy';
import { LiveWorkspace } from './workspace-client';
import './workspace.css';
export const dynamic='force-dynamic';
export default async function Workspace(){
 if(!await verifiedWorkspaceUser())redirect('/sign-in');
 const client=await workspaceSupabase();
 const result=await client?.rpc('workspace_account');
 const parsed=workspaceAccountSchema.safeParse(result?.data);
 if(result?.error||!parsed.success)return <main className="live-workspace"><h1>Workspace temporarily unavailable</h1><p>Please try again shortly.</p><a href="/sign-in">Return to sign in</a></main>;
 if(parsed.data.status!=='active')return <main className="live-workspace"><h1>{parsed.data.status==='pending'?'Your account is awaiting approval':'Workspace access is suspended'}</h1><p>An administrator must approve your account and assign the appropriate tools. This account cannot access property records yet.</p><a href="/sign-out">Sign out</a></main>;
 return <LiveWorkspace account={parsed.data}/>;
}
