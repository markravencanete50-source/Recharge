import { isWorkspaceAdmin, MODULE_IDS, type ModuleId, type WorkspaceRole } from './modules';

export type ActivityAction = 'open_tool' | 'view_record' | 'save_tool' | 'unsave_tool' | 'export_report' | 'update_profile';
export type PersonalActivity = {id:string;at:number;action:ActivityAction;moduleId?:ModuleId};
const actions:ActivityAction[]=['open_tool','view_record','save_tool','unsave_tool','export_report','update_profile'];
export const ACTIVITY_LIMIT=50;

export function activityAllowed(event:PersonalActivity,role:WorkspaceRole,modules:readonly ModuleId[]) {
  if(event.action==='export_report')return isWorkspaceAdmin(role);
  if(event.action==='update_profile')return true;
  return Boolean(event.moduleId&&modules.includes(event.moduleId));
}
export function parseActivity(raw:string|null):PersonalActivity[] {
  try {
    const list:unknown=JSON.parse(raw||'[]');
    if(!Array.isArray(list))return [];
    return list.filter((item):item is PersonalActivity=>Boolean(item&&typeof item==='object'&&typeof item.id==='string'&&Number.isFinite(item.at)&&item.at>0&&Number.isFinite(new Date(item.at).getTime())&&actions.includes(item.action)&&(!item.moduleId||MODULE_IDS.includes(item.moduleId))))
      // Store only action metadata. No names, messages, addresses or credentials.
      .map(({id,at,action,moduleId})=>({id,at,action,...(moduleId?{moduleId}:{})}))
      .sort((a,b)=>b.at-a.at).slice(0,ACTIVITY_LIMIT);
  }catch{return [];}
}
export function appendActivity(list:PersonalActivity[],event:PersonalActivity) {
  const last=list[0];
  if(last&&last.action===event.action&&last.moduleId===event.moduleId&&event.at-last.at>=0&&event.at-last.at<2000)return list;
  return [event,...list].sort((a,b)=>b.at-a.at).slice(0,ACTIVITY_LIMIT);
}
export function activityText(event:PersonalActivity,title='tool') {
  return event.action==='open_tool'?`Opened ${title}`:event.action==='view_record'?`Viewed a record in ${title}`:event.action==='save_tool'?`Pinned ${title}`:event.action==='unsave_tool'?`Unpinned ${title}`:event.action==='export_report'?'Exported a CSV report':'Updated your profile';
}
