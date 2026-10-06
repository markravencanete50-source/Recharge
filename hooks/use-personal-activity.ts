import { useCallback, useEffect, useState } from 'react';
import { activityAllowed, appendActivity, parseActivity, type ActivityAction, type PersonalActivity } from '@/lib/recent-activity';
import type { ModuleId, WorkspaceRole } from '@/lib/modules';

export function usePersonalActivity(account:string,role:WorkspaceRole,modules:readonly ModuleId[]) {
  const key='recharge:personal-activity:'+encodeURIComponent(account)+':'+role;
  const [state,setState]=useState<{key:string;items:PersonalActivity[]}>({key,items:[]});
  const [readyKey,setReadyKey]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{
      if(!active)return;
      try {
        const stored=parseActivity(sessionStorage.getItem(key));
        setState(current=>({key,items:parseActivity(JSON.stringify([...new Map([...stored,...(current.key===key?current.items:[])].map(item=>[item.id,item])).values()]))}));
        setError('');
      }
      catch {setState(current=>({key,items:current.key===key?current.items:[]}));setError('Activity is available for this visit only.');}
      setReadyKey(key);
    });
    return()=>{active=false;};
  },[key]);
  useEffect(()=>{
    if(readyKey!==key||state.key!==key)return;
    try {sessionStorage.setItem(key,JSON.stringify(state.items));}
    catch {queueMicrotask(()=>setError('Activity is available for this visit only.'));}
  },[key,readyKey,state]);
  const record=useCallback((action:ActivityAction,moduleId?:ModuleId)=>{
    const at=Date.now(),event:PersonalActivity={id:at.toString(36)+'-'+Math.random().toString(36).slice(2,8),at,action,...(moduleId?{moduleId}:{})};
    if(!activityAllowed(event,role,modules))return;
    setState(current=>({key,items:appendActivity(current.key===key?current.items:[],event)}));
  },[key,role,modules]);
  return {items:state.key===key?state.items.filter(item=>activityAllowed(item,role,modules)):[],record,error};
}
