"use client";
import { useMemo, useState } from 'react';
import { CircleHelp, Activity, Search, ChevronDown, Eye, Bookmark, Download, UserRound } from 'lucide-react';
import { faqsForAccess } from '@/lib/access-faq';
import { activityText, type PersonalActivity } from '@/lib/recent-activity';
import { MODULES, type ModuleId, type WorkspaceRole } from '@/lib/modules';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function WorkspaceHelp({role,modules,items,error}:{role:WorkspaceRole;modules:readonly ModuleId[];items:PersonalActivity[];error:string}) {
  const [panel,setPanel]=useState<'help'|'activity'|null>(null),[query,setQuery]=useState('');
  const faqs=useMemo(()=>faqsForAccess(role,modules),[role,modules]);
  const answers=faqs.filter(faq=>(faq.question+' '+faq.answer).toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="workspace-help-links"><button type="button" onClick={()=>{setQuery('');setPanel('help');}}><CircleHelp size={18}/>Help and FAQs</button><button type="button" onClick={()=>setPanel('activity')}><Activity size={18}/>Recent activity</button></div>
    <Dialog open={panel!==null} onOpenChange={open=>{if(!open)setPanel(null);}}><DialogContent className="workspace-help-dialog"><DialogHeader><DialogTitle>{panel==='help'?'Help for your access':'Recent activity'}</DialogTitle><DialogDescription>{panel==='help'?'Answers matched to the tools your account can access.':'Your actions on this device.'}</DialogDescription></DialogHeader>
      {panel==='help'?<><label className="workspace-help-search"><Search size={18}/><input aria-label="Search FAQs" placeholder="Search FAQs" value={query} onChange={event=>setQuery(event.target.value)}/></label><p className="workspace-help-count" aria-live="polite">{answers.length} {answers.length===1?'answer':'answers'} for your access</p><div className="workspace-help-results">{answers.map(faq=><details key={faq.id}><summary><span><small>{faq.topic}</small>{faq.question}</span><ChevronDown size={18}/></summary><p>{faq.answer}</p></details>)}{!answers.length&&<p>No answers match. Try a shorter search.</p>}</div></>:<div className="workspace-help-results">{!!error&&<p role="alert">{error}</p>}{!items.length?<p>Your recent actions will appear here when you open a tool or export a report.</p>:items.map(event=>{const Icon=event.action==='export_report'?Download:event.action==='save_tool'||event.action==='unsave_tool'?Bookmark:event.action==='update_profile'?UserRound:Eye;return <div className="workspace-activity-row" key={event.id}><Icon size={18}/><div><p>{activityText(event,MODULES.find(tool=>tool.id===event.moduleId)?.name)}</p><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div></div>;})}</div>}
    </DialogContent></Dialog>
  </>;
}
