import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Text } from './Typography';
import { Artwork } from './Artwork';
import { MotionPress } from './motion';
import { ui, type Palette } from './theme';
import type { Tool } from './model';
import { WORKSPACE_MAP, type WorkspaceSection } from '../../lib/workspace-map';
import { findTools, titleParts } from '../../lib/tool-finder';
import { DEPARTMENTS } from './DepartmentGrid';

export function CommandSearch({tools,palette:p,onOpen,onNavigate,onProfile,onClose}:{tools:Tool[];palette:Palette;onOpen:(tool:Tool)=>void;onNavigate:(section:WorkspaceSection)=>void;onProfile:()=>void;onClose:()=>void}) {
  const [query,setQuery]=useState(''),[selected,setSelected]=useState(0);
  const input=useRef<TextInput>(null),root=useRef<View>(null);
  const entries=useMemo(()=>tools.map(tool=>({key:tool.id,name:tool.name,tone:WORKSPACE_MAP[tool.id].tone,tool})),[tools]);
  const links=[{key:'analytics',name:'Reports and analytics',icon:'bar-chart-2' as const,run:()=>onNavigate('analytics')},{key:'calendar',name:'Calendar',icon:'calendar' as const,run:()=>onNavigate('calendar')},{key:'inbox',name:'Inbox',icon:'message-circle' as const,run:()=>onNavigate('inbox')},{key:'profile',name:'Profile and preferences',icon:'user' as const,run:onProfile}];
  const results=findTools(entries,query);
  const quick=links.filter(link=>link.name.toLowerCase().includes(query.trim().toLowerCase()));
  // Group before numbering so arrow keys follow the visible order exactly.
  const grouped=DEPARTMENTS.flatMap(department=>results.filter(entry=>entry.tone===department.id));
  const actions=[...quick.map(link=>({key:link.key,name:link.name,run:link.run})),...grouped.map(entry=>({key:entry.key,name:entry.name,run:()=>onOpen(entry.tool)}))];
  const choose=(index:number)=>{const action=actions[index];if(!action)return;onClose();action.run();};
  useEffect(()=>{
    const previous=Platform.OS==='web'?document.activeElement as HTMLElement:null;
    const timer=setTimeout(()=>input.current?.focus(),160);
    return()=>{clearTimeout(timer);previous?.focus();};
  },[]);
  useEffect(()=>{
    if(Platform.OS!=='web')return;
    const node=root.current as unknown as HTMLElement;
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}
      if(event.key==='Tab'){
        const dialog=node?.closest('[aria-modal=true]')||node;
        const controls=Array.from(dialog?.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')||[]).filter(element=>element.getClientRects().length&&!element.hasAttribute('disabled'));
        if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
        else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
      }
      if(!(event.target instanceof HTMLInputElement))return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();const next=actions.length?(selected+(event.key==='ArrowDown'?1:-1)+actions.length)%actions.length:0;setSelected(next);
        node?.querySelector('[data-command-key="'+actions[next]?.key+'"]')?.scrollIntoView({block:'nearest'});
      }
      if(event.key==='Enter'){event.preventDefault();choose(selected);}
    };
    document.addEventListener('keydown',keydown,true);return()=>document.removeEventListener('keydown',keydown,true);
  });
  const row=(key:string,name:string,index:number,icon:React.ReactNode)=><MotionPress key={key} accessibilityRole="button" accessibilityLabel={'Go to '+name} accessibilityState={{selected:index===selected}} {...(Platform.OS==='web'?{dataSet:{commandKey:key}}:{})} onPress={()=>choose(index)} style={[ui.row,{minHeight:52,gap:12,paddingHorizontal:10,paddingVertical:6,borderRadius:14,backgroundColor:index===selected?p.wash:'transparent'}]}>{icon}<Text style={{flex:1,color:p.text,fontSize:14,lineHeight:20,fontWeight:index===selected?'600':'500'}}>{titleParts(name,query).map((part,i)=><Text key={i} style={part.match?{color:p.primary,fontWeight:'700'}:undefined}>{part.text}</Text>)}</Text>{index===selected?<View style={{paddingHorizontal:8,paddingVertical:3,borderRadius:8,backgroundColor:p.surface,borderWidth:1,borderColor:p.border}}><Text style={{fontSize:11,fontWeight:'600',color:p.muted}}>{Platform.OS==='web'?'Enter':'Open'}</Text></View>:<Feather name="arrow-up-right" size={16} color={p.muted}/>}</MotionPress>;
  const heading={color:p.muted,fontSize:11,fontWeight:'600' as const,letterSpacing:1.4,textTransform:'uppercase' as const,paddingHorizontal:10};
  return <View ref={root} style={{gap:10}}>
    <View {...(Platform.OS==='web'?{dataSet:{searchShell:'true'}}:{})} style={[ui.row,{gap:12,borderWidth:1,borderColor:p.border,borderRadius:18,paddingHorizontal:16,backgroundColor:p.background}]}><Feather name="search" size={20} color={p.muted}/><TextInput ref={input} accessibilityLabel="Quick search feature titles" placeholder="Where do you want to go?" placeholderTextColor={p.muted} value={query} onChangeText={value=>{setQuery(value);setSelected(0);}} autoCorrect={false} returnKeyType="go" onSubmitEditing={Platform.OS==='web'?undefined:()=>choose(selected)} style={{flex:1,minHeight:52,fontSize:16,color:p.text,fontFamily:'Montserrat_400Regular'}}/></View>
    <Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.muted}]}>{grouped.length} matching tools. {actions[selected]?'Selected: '+actions[selected].name:'No tool matches. Try a shorter word.'}</Text>
    {!!quick.length&&<><Text style={heading}>Quick access</Text>{quick.map((link,index)=>row(link.key,link.name,index,<View style={{width:36,height:36,borderRadius:12,backgroundColor:p.wash,alignItems:'center',justifyContent:'center'}}><Feather name={link.icon} size={17} color={p.primary}/></View>))}</>}
    {DEPARTMENTS.map(department=>{const matches=grouped.filter(entry=>entry.tone===department.id);return matches.length?<View key={department.id} style={{gap:2}}><Text style={[heading,{paddingTop:10}]}>{department.name} · {matches.length}</Text>{matches.map(entry=>row(entry.key,entry.name,quick.length+grouped.indexOf(entry),<Artwork id={entry.tool.id} size={36} palette={p}/>))}</View>:null;})}
    {Platform.OS==='web'?<View style={[ui.row,{gap:14,flexWrap:'wrap',paddingTop:4}]}>{[['↑ ↓','move'],['Enter','open'],['Esc','close']].map(([key,label])=><View key={key} style={[ui.row,{gap:6}]}><View style={{paddingHorizontal:7,paddingVertical:2,borderRadius:7,borderWidth:1,borderColor:p.border,backgroundColor:p.background}}><Text style={{fontSize:11,fontWeight:'600',color:p.text}}>{key}</Text></View><Text style={{fontSize:12,color:p.muted}}>{label}</Text></View>)}</View>:<Text style={[ui.small,{color:p.muted}]}>Tap a result to open it.</Text>}
  </View>;
}
