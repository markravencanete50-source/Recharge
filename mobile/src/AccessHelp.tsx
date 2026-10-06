import { useMemo, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { FeatureTile } from './Artwork';
import Feather from '@expo/vector-icons/Feather';
import { faqsForAccess } from '../../lib/access-faq';
import { activityText, type PersonalActivity } from '../../lib/recent-activity';
import { toolsFor, roles, type Tool, type WorkspaceRole } from './model';
import { Text } from './Typography';
import { Entrance, MotionPress } from './motion';
import { ui, type Palette } from './theme';
import { FilterBar } from './FilterBar';

export function AccessHelp({role,palette:p,onOpen}:{role:WorkspaceRole;palette:Palette;onOpen:(tool:Tool)=>void}) {
  const tools=useMemo(()=>toolsFor(role),[role]);
  const faqs=useMemo(()=>faqsForAccess(role,tools.map(tool=>tool.id)),[role,tools]);
  const [query,setQuery]=useState(''),[expanded,setExpanded]=useState<string|null>(null),[topic,setTopic]=useState('All');
  const results=faqs.filter(faq=>(topic==='All'||faq.topic===topic)&&(faq.question+' '+faq.answer).toLowerCase().includes(query.trim().toLowerCase()));
  return <View style={{gap:20}}>
    <View style={{gap:6}}><Text accessibilityRole="header" style={[ui.title,{color:p.text}]}>Help for your role</Text><Text style={[ui.body,{color:p.muted}]}>{roles.find(r=>r.value===role)?.label} guidance, matched to the tools you can access.</Text></View>
    <View {...(Platform.OS==='web'?{dataSet:{searchShell:'true'}}:{})} style={[ui.row,{minHeight:50,gap:10,borderWidth:1,borderColor:p.controlBorder,borderRadius:14,paddingHorizontal:14,backgroundColor:p.surface}]}><Feather name="search" size={18} color={p.muted}/><TextInput accessibilityLabel="Search FAQs" placeholder="Search FAQs" placeholderTextColor={p.muted} value={query} onChangeText={setQuery} style={{flex:1,minHeight:48,fontSize:15,color:p.text}}/>{!!query&&<MotionPress accessibilityRole="button" accessibilityLabel="Clear FAQ search" onPress={()=>setQuery('')} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="x" color={p.muted} size={18}/></MotionPress>}</View>
    <FilterBar values={['All',...new Set(faqs.map(faq=>faq.topic))]} selected={topic} onSelect={setTopic} palette={p}/>
    <Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.muted}]}>{results.length} {results.length===1?'answer':'answers'} for your access</Text>
    {results.map(faq=><View key={faq.id} style={[ui.card,{backgroundColor:p.surface,borderColor:expanded===faq.id?p.primary:p.border,padding:0,gap:0,overflow:'hidden'}]}><MotionPress accessibilityRole="button" accessibilityLabel={faq.question} accessibilityState={{expanded:expanded===faq.id}} onPress={()=>setExpanded(expanded===faq.id?null:faq.id)} style={[ui.row,{gap:12,minHeight:64,padding:16}]}><View style={{flex:1,gap:4}}><Text style={{fontSize:11,fontWeight:'600',letterSpacing:1.2,textTransform:'uppercase',color:p.muted}}>{faq.topic}</Text><Text style={{fontSize:15,lineHeight:22,fontWeight:'600',color:p.text}}>{faq.question}</Text></View><View style={{width:32,height:32,borderRadius:16,backgroundColor:expanded===faq.id?p.primary:p.elevated,alignItems:'center',justifyContent:'center'}}><Feather name={expanded===faq.id?'minus':'plus'} size={16} color={expanded===faq.id?p.onPrimary:p.text}/></View></MotionPress>{expanded===faq.id&&<Entrance trigger={faq.id} style={{paddingHorizontal:16,paddingBottom:16,gap:16}}><Text style={[ui.body,{color:p.muted}]}>{faq.answer}</Text>{faq.moduleId&&<MotionPress accessibilityRole="button" onPress={()=>{const tool=tools.find(tool=>tool.id===faq.moduleId);if(tool)onOpen(tool);}} style={[ui.row,{gap:8,minHeight:44}]}><Text style={[ui.small,{color:p.primary,fontWeight:'600',flexShrink:1}]}>Open {tools.find(tool=>tool.id===faq.moduleId)?.shortName}</Text><Feather name="arrow-right" size={16} color={p.primary}/></MotionPress>}</Entrance>}</View>)}
    {!results.length&&<Text style={[ui.body,{color:p.muted}]}>No answers match. Try a shorter search or another topic.</Text>}
  </View>;
}

export function RecentActivity({items,palette:p,onOpen,error='',framed=false}:{items:PersonalActivity[];palette:Palette;onOpen?:(event:PersonalActivity)=>void;error?:string;framed?:boolean}) {
  return <View style={[{gap:framed?0:12},framed&&items.length?[ui.card,{backgroundColor:p.surface,borderColor:p.border,paddingVertical:6}]:null]}><Text style={[ui.small,{color:p.muted}]}>Your actions on this device</Text>{!!error&&<Text accessibilityRole="alert" style={[ui.small,{color:p.muted}]}>{error}</Text>}
    {!items.length?<View style={[ui.card,{backgroundColor:p.surface,borderColor:p.border}]}><FeatureTile icon="activity" size={44} palette={p}/><Text style={[ui.body,{color:p.text}]}>Your recent actions will appear here.</Text><Text style={[ui.small,{color:p.muted}]}>Open a tool or pin a favourite to start your history.</Text></View>:items.map(event=>{
      const title=toolsFor('super_admin').find(tool=>tool.id===event.moduleId)?.name;
      return <MotionPress key={event.id} accessibilityRole={event.moduleId&&onOpen?'button':undefined} disabled={!event.moduleId||!onOpen} onPress={()=>onOpen?.(event)} {...(Platform.OS==='web'?{dataSet:{hover:'tint'}}:{})} style={[ui.row,{gap:12,minHeight:68,paddingVertical:12,paddingHorizontal:12,marginHorizontal:-12,borderRadius:16}]}><View style={{width:40,height:40,backgroundColor:p.wash,borderRadius:13,alignItems:'center',justifyContent:'center'}}><Feather name={event.action==='export_report'?'download':event.action==='save_tool'||event.action==='unsave_tool'?'bookmark':event.action==='update_profile'?'user':'eye'} size={18} color={p.primary}/></View><View style={{flex:1,gap:4}}><Text style={{color:p.text,fontSize:14,lineHeight:20,fontWeight:'500'}}>{activityText(event,title)}</Text><Text style={{color:p.muted,fontSize:12,lineHeight:18}}>{new Date(event.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</Text></View>{event.moduleId&&onOpen&&<Feather name="chevron-right" size={18} color={p.muted}/>}</MotionPress>;
    })}</View>;
}
