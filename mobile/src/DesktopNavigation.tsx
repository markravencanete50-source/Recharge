import { useEffect, useState } from 'react';
import { Animated, Platform, ScrollView, View } from 'react-native';
import { navigationFor, type WorkspaceSection } from '../../lib/workspace-map';
import { DEPARTMENTS } from './DepartmentGrid';
import { toolsFor, type WorkspaceRole } from './model';
import { WORKSPACE_MAP } from '../../lib/workspace-map';
import { DepartmentArtwork } from './Artwork';
import { NavSymbol, MotionPress, useReducedMotion } from './motion';
import { Text } from './Typography';
import { ui, type Palette } from './theme';
import { CompanyLogo } from './CompanyLogo';
export function DesktopNavigation({role,section,palette:p,onNavigate,onDepartment,onProfile}:{role:WorkspaceRole;section:WorkspaceSection;palette:Palette;onNavigate:(section:WorkspaceSection)=>void;onDepartment:(department:string)=>void;onProfile:()=>void}) {
  const [expanded,setExpanded]=useState(true); const tools=toolsFor(role);
  const index=Math.max(0,navigationFor(role).findIndex(item=>item.value===section));
  const [indicator]=useState(()=>new Animated.Value(index*60)); const reduced=useReducedMotion();
  useEffect(()=>{if(reduced){indicator.setValue(index*60);return;}const animation=Animated.spring(indicator,{toValue:index*60,speed:24,bounciness:0,useNativeDriver:Platform.OS!=='web'});animation.start();return()=>animation.stop();},[indicator,index,reduced]);
  return <View style={{width:240,backgroundColor:p.isDark?p.surface:p.background,borderRightWidth:1,borderColor:p.border,gap:24}}>
    <View testID="sidebar-brand" style={{height:81,justifyContent:'center',alignItems:'center',backgroundColor:p.header}}><CompanyLogo palette={p} variant="dark" width={200}/></View>
    <ScrollView contentContainerStyle={{gap:8,paddingHorizontal:16,paddingBottom:24}} showsVerticalScrollIndicator={false}><Animated.View pointerEvents="none" style={{position:'absolute',left:16,top:0,width:3,height:52,borderRadius:999,zIndex:1,backgroundColor:p.primary,transform:[{translateY:indicator}]}}/>{navigationFor(role).map(item=><MotionPress key={item.value} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected:section===item.value}} onPress={()=>onNavigate(item.value)} style={[ui.row,{height:52,gap:14,paddingHorizontal:14,borderRadius:14,backgroundColor:section===item.value?p.wash:'transparent'}]}><NavSymbol name={item.icon} active={section===item.value} color={section===item.value?p.primary:p.muted}/><Text style={{fontSize:14,fontWeight:'600',color:section===item.value?p.primary:p.text}}>{item.label}</Text></MotionPress>)}
      <MotionPress accessibilityRole="button" accessibilityLabel="Toggle department shortcuts" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={[ui.between,{marginTop:24,minHeight:48}]}><Text style={[ui.small,{color:p.muted,fontWeight:'600'}]}>Departments</Text><Text style={{color:p.muted}}>{expanded?'Hide':'Show'}</Text></MotionPress>
      {expanded&&DEPARTMENTS.map(d=>{const count=tools.filter(tool=>WORKSPACE_MAP[tool.id].tone===d.id).length;return count?<MotionPress key={d.id} accessibilityRole="button" accessibilityLabel={'Open '+d.name+' department, '+count+' tools'} onPress={()=>onDepartment(d.id)} style={[ui.row,{gap:10,minHeight:56}]}><DepartmentArtwork department={d.id} size={36} palette={p}/><Text style={[ui.small,{color:p.text,flex:1}]}>{d.name}</Text><Text style={[ui.small,{color:p.muted}]}>{count}</Text></MotionPress>:null;})}
    </ScrollView>
    <MotionPress accessibilityRole="button" accessibilityLabel="Open profile and preview roles" onPress={onProfile} style={[ui.button,{backgroundColor:p.elevated,marginHorizontal:16,marginBottom:16}]}><Text style={[ui.buttonText,{color:p.text}]}>Profile and preferences</Text></MotionPress>
  </View>;
}
