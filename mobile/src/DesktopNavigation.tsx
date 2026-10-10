import { useEffect, useState } from 'react';
import { Animated, Platform, ScrollView, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { navigationFor, type WorkspaceSection } from '../../lib/workspace-map';
import { DEPARTMENTS } from './DepartmentGrid';
import { toolsFor, type WorkspaceRole } from './model';
import { WORKSPACE_MAP } from '../../lib/workspace-map';
import { DepartmentArtwork } from './Artwork';
import { NavSymbol, MotionPress, useReducedMotion } from './motion';
import { Text } from './Typography';
import { ui, type Palette } from './theme';
import { CompanyLogo } from './CompanyLogo';
import type { NavigationItem } from './NavigationBar';

const ROW=52, GAP=6;
// One of the role's work areas, listed under its destinations so the panel shows what this role works on.
export type WorkArea={value:string;label:string;icon:keyof typeof Feather.glyphMap};
const hover=Platform.OS==='web'?{dataSet:{hover:'tint'}}:{};

export function DesktopNavigation({role,section,palette:p,onNavigate,onDepartment,onProfile,onCollapse,items:custom,profileDetail='Theme, motion and roles',workAreas,workArea,onWorkArea,badge}:{workAreas?:readonly WorkArea[];workArea?:string;onWorkArea?:(value:string)=>void;badge?:{label:string;detail:string;previewing:boolean};role:WorkspaceRole;section:WorkspaceSection;palette:Palette;onNavigate:(section:WorkspaceSection)=>void;onDepartment?:(department:string)=>void;onProfile:()=>void;onCollapse:()=>void;items?:readonly NavigationItem[];profileDetail?:string}) {
  const [expanded,setExpanded]=useState(true); const tools=toolsFor(role);
  // Clients reach tools from Home on phones; desktop has room to list them too.
  // The live workspace passes its own destinations and has no department shortcuts.
  const items=custom??(role==='client'?[...navigationFor(role),{value:'more' as const,label:'Tools',icon:'grid' as const}]:navigationFor(role));
  const found=items.findIndex(item=>item.value===section);
  const index=Math.max(0,found);
  const [indicator]=useState(()=>new Animated.Value(index*(ROW+GAP))); const reduced=useReducedMotion();
  useEffect(()=>{if(reduced){indicator.setValue(index*(ROW+GAP));return;}const animation=Animated.spring(indicator,{toValue:index*(ROW+GAP),speed:16,bounciness:2,useNativeDriver:Platform.OS!=='web'});animation.start();return()=>animation.stop();},[indicator,index,reduced]);
  return <View testID="workspace-sidebar" style={{width:248,backgroundColor:p.isDark?p.surface:p.background,borderRightWidth:1,borderColor:p.border}}>
    <View testID="sidebar-brand" style={[ui.between,{height:81,paddingHorizontal:16,gap:12,backgroundColor:p.header,borderBottomWidth:1,borderColor:p.isDark?p.border:p.header}]}><CompanyLogo palette={p} width={144}/><MotionPress accessibilityRole="button" accessibilityLabel="Hide left panel" accessibilityState={{expanded:true}} onPress={onCollapse} style={[ui.iconButton,{width:44,height:44,borderRadius:14,backgroundColor:p.headerControl,borderColor:p.headerBorder}]}><Feather name="chevrons-left" size={18} color={p.headerControlText}/></MotionPress></View>
    <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingTop:20,paddingBottom:24}} showsVerticalScrollIndicator={false}>
      {!!badge&&<View accessibilityRole="text" accessibilityLabel={badge.label+'. '+badge.detail} style={[ui.row,{gap:10,marginBottom:16,padding:10,borderRadius:14,borderWidth:1,borderColor:badge.previewing?p.primary:p.border,backgroundColor:badge.previewing?p.wash:'transparent'}]}>
        <Feather name={badge.previewing?'eye':'user'} size={15} color={p.primary}/>
        <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{fontSize:13,fontWeight:'700',color:p.text}}>{badge.label}</Text><Text numberOfLines={1} style={{fontSize:11,color:p.muted}}>{badge.detail}</Text></View>
      </View>}
      <Text style={{color:p.muted,fontSize:11,fontWeight:'600',letterSpacing:1.4,textTransform:'uppercase',paddingHorizontal:12,marginBottom:10}}>Workspace</Text>
      <View style={{gap:GAP}}>
        {/* One pill slides between items instead of each row repainting. */}
        <Animated.View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:0,height:ROW,borderRadius:16,backgroundColor:p.wash,opacity:found<0?0:1,transform:[{translateY:indicator}]}}>
          <View style={{position:'absolute',left:-14,top:14,bottom:14,width:4,borderTopRightRadius:4,borderBottomRightRadius:4,backgroundColor:p.primary}}/>
        </Animated.View>
        {items.map(item=>{const selected=section===item.value;return <MotionPress key={item.value} {...hover} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected}} onPress={()=>onNavigate(item.value)} style={[ui.row,{height:ROW,gap:14,paddingHorizontal:14,borderRadius:16}]}><NavSymbol name={item.icon} active={selected} color={selected?p.primary:p.muted}/><Text style={{fontSize:14,fontWeight:selected?'700':'500',color:selected?p.primary:p.text}}>{item.label}</Text></MotionPress>;})}
      </View>
      {!!workAreas?.length&&onWorkArea&&<>
        <Text style={{color:p.muted,fontSize:11,fontWeight:'600',letterSpacing:1.4,textTransform:'uppercase',paddingHorizontal:12,marginTop:24,marginBottom:6}}>Your work</Text>
        <View style={{gap:2}}>{workAreas.map(area=>{const selected=section==='work'&&workArea===area.value;return <MotionPress key={area.value} {...hover} accessibilityRole="button" accessibilityLabel={'Work: '+area.label} accessibilityState={{selected}} onPress={()=>onWorkArea(area.value)} style={[ui.row,{minHeight:40,gap:12,paddingHorizontal:14,borderRadius:12,backgroundColor:selected?p.wash:'transparent'}]}>
          <Feather name={area.icon} size={16} color={selected?p.primary:p.muted}/><Text numberOfLines={1} style={{flex:1,fontSize:13,fontWeight:selected?'700':'500',color:selected?p.primary:p.text}}>{area.label}</Text>
        </MotionPress>;})}</View>
      </>}
      {!!onDepartment&&<><MotionPress accessibilityRole="button" accessibilityLabel="Toggle department shortcuts" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={[ui.between,{marginTop:26,minHeight:40,paddingHorizontal:12}]}><Text style={{color:p.muted,fontSize:11,fontWeight:'600',letterSpacing:1.4,textTransform:'uppercase'}}>Departments</Text><Feather name={expanded?'chevron-up':'chevron-down'} size={16} color={p.muted}/></MotionPress>
      {expanded&&<View style={{gap:2,marginTop:4}}>{DEPARTMENTS.map(d=>{const count=tools.filter(tool=>WORKSPACE_MAP[tool.id].tone===d.id).length;return count?<MotionPress key={d.id} {...hover} accessibilityRole="button" accessibilityLabel={'Open '+d.name+' department, '+count+' tools'} onPress={()=>onDepartment(d.id)} style={[ui.row,{gap:12,minHeight:48,paddingHorizontal:8,borderRadius:14}]}><DepartmentArtwork department={d.id} size={32} palette={p}/><Text style={{fontSize:14,color:p.text,flex:1,fontWeight:'500'}}>{d.name}</Text><View style={{minWidth:26,paddingHorizontal:7,paddingVertical:2,borderRadius:999,backgroundColor:p.elevated,alignItems:'center'}}><Text style={{fontSize:11,fontWeight:'600',color:p.muted}}>{count}</Text></View></MotionPress>:null;})}</View>}</>}
    </ScrollView>
    <MotionPress {...hover} accessibilityRole="button" accessibilityLabel="Open profile and preferences" onPress={onProfile} style={[ui.row,{gap:12,margin:14,padding:12,borderRadius:18,borderWidth:1,borderColor:p.border,backgroundColor:p.surface}]}>
      <View style={{width:38,height:38,borderRadius:12,backgroundColor:p.header,alignItems:'center',justifyContent:'center'}}><Feather name="settings" size={17} color={p.headerText}/></View>
      <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{fontSize:13,fontWeight:'600',color:p.text}}>Profile</Text><Text numberOfLines={1} style={{fontSize:12,color:p.muted}}>{profileDetail}</Text></View>
      <Feather name="chevron-right" size={16} color={p.muted}/>
    </MotionPress>
  </View>;
}
