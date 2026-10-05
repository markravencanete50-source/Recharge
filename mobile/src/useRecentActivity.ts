import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activityAllowed, appendActivity, parseActivity, type PersonalActivity, type ActivityAction } from '../../lib/recent-activity';
import { defaultModulesForRole, type ModuleId, type WorkspaceRole } from '../../lib/modules';

export function useRecentActivity(role:WorkspaceRole) {
  const key='recharge:preview:activity:'+role;
  const [state,setState]=useState<{key:string;items:PersonalActivity[]}>({key,items:[]});
  const [readyKey,setReadyKey]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    AsyncStorage.getItem(key).then(raw=>{if(active){setState(current=>({key,items:parseActivity(JSON.stringify([...new Map([...parseActivity(raw),...(current.key===key?current.items:[])].map(item=>[item.id,item])).values()]))}));setError('');setReadyKey(key);}}).catch(()=>{if(active){setState(current=>({key,items:current.key===key?current.items:[]}));setError('Activity is available for this visit only.');setReadyKey(key);}});
    return()=>{active=false;};
  },[key]);
  useEffect(()=>{
    if(state.key!==key||readyKey!==key)return;
    // Avoid overwriting stored activity before the initial read finishes.
    if(!state.items.length)return;
    AsyncStorage.setItem(key,JSON.stringify(state.items)).catch(()=>setError('Activity is available for this visit only.'));
  },[state,key,readyKey]);
  const modules=useMemo(()=>defaultModulesForRole(role),[role]);
  const record=useCallback((action:ActivityAction,moduleId?:ModuleId)=>{
    const at=Date.now(),event:PersonalActivity={id:at.toString(36)+'-'+Math.random().toString(36).slice(2,8),at,action,...(moduleId?{moduleId}:{})};
    if(!activityAllowed(event,role,modules))return;
    setState(current=>({key,items:appendActivity(current.key===key?current.items:[],event)}));
  },[key,role,modules]);
  return {items:state.key===key?state.items.filter(item=>activityAllowed(item,role,modules)):[],record,error};
}
