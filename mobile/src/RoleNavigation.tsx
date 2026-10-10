import { Platform, ScrollView, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { MotionPress } from './motion';
import { Text } from './Typography';
import { ui, type Palette } from './theme';
import { CompanyLogo } from './CompanyLogo';
import type { PanelLink, RolePanel } from '../../lib/role-panel';

type Icon = keyof typeof Feather.glyphMap;
const hover=Platform.OS==='web'?{dataSet:{hover:'tint'}}:{};
const label={fontSize:11,fontWeight:'600' as const,letterSpacing:1.4,textTransform:'uppercase' as const};

// The live workspace's desktop left panel: the role's own heading and groups (lib/role-panel.ts).
// While a super admin views as someone, it is that person's or role's panel, marked as a view.
export function RoleNavigation({panel,selected,palette:p,onOpen,onProfile,onCollapse,badges={},viewing,onBack}:{
  panel:RolePanel;selected:string;palette:Palette;onOpen:(link:PanelLink)=>void;onProfile:()=>void;onCollapse:()=>void;
  badges?:Record<string,number>;viewing?:{name:string;detail:string}|null;onBack?:()=>void;
}) {
  return <View testID="workspace-sidebar" style={{width:256,backgroundColor:p.isDark?p.surface:p.background,borderRightWidth:1,borderColor:p.border}}>
    <View testID="sidebar-brand" style={[ui.between,{height:81,paddingHorizontal:16,gap:12,backgroundColor:p.header,borderBottomWidth:1,borderColor:p.isDark?p.border:p.header}]}><CompanyLogo palette={p} width={144}/><MotionPress accessibilityRole="button" accessibilityLabel="Hide left panel" accessibilityState={{expanded:true}} onPress={onCollapse} style={[ui.iconButton,{width:44,height:44,borderRadius:14,backgroundColor:p.headerControl,borderColor:p.headerBorder}]}><Feather name="chevrons-left" size={18} color={p.headerControlText}/></MotionPress></View>
    <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingTop:16,paddingBottom:24}} showsVerticalScrollIndicator={false}>
      <View testID="sidebar-role" accessibilityRole="header" accessibilityLabel={(viewing?`Viewing as ${viewing.name}. `:'')+panel.title+' workspace. '+panel.tagline} style={{gap:10,marginBottom:12,padding:12,borderRadius:16,borderWidth:viewing?2:1,borderColor:viewing?p.primary:p.border,backgroundColor:viewing?p.wash:p.surface}}>
        <View style={[ui.row,{gap:10}]}>
          <View style={{width:36,height:36,borderRadius:12,backgroundColor:p.header,alignItems:'center',justifyContent:'center'}}><Feather name={panel.icon as Icon} size={17} color={p.headerText}/></View>
          <View style={{flex:1,minWidth:0}}>
            <Text numberOfLines={1} style={{fontSize:15,fontWeight:'800',color:p.text}}>{panel.title}</Text>
            <Text numberOfLines={2} style={{fontSize:11,lineHeight:15,color:p.muted}}>{panel.tagline}</Text>
          </View>
        </View>
        {!!viewing&&<View style={{gap:8}}>
          <View style={[ui.row,{gap:6}]}><Feather name="eye" size={13} color={p.primary}/><Text numberOfLines={1} style={{flex:1,fontSize:12,fontWeight:'700',color:p.primary}}>{viewing.name}</Text></View>
          <Text style={{fontSize:11,lineHeight:15,color:p.muted}}>{viewing.detail}</Text>
          {!!onBack&&<MotionPress accessibilityRole="button" onPress={onBack} style={[ui.row,{justifyContent:'center',gap:6,minHeight:36,borderRadius:999,backgroundColor:p.primary}]}><Feather name="corner-up-left" size={14} color={p.onPrimary}/><Text style={{fontSize:12,fontWeight:'700',color:p.onPrimary}}>Back to my view</Text></MotionPress>}
        </View>}
      </View>
      {panel.groups.map(group=><View key={group.title} style={{marginTop:14}}>
        <Text accessibilityRole="header" style={[label,{color:p.muted,paddingHorizontal:12,marginBottom:6}]}>{group.title}</Text>
        <View style={{gap:2}}>{group.links.map(link=>{
          const on=link.key===selected, count=badges[link.key]??0, start=link.kind==='start';
          return <MotionPress key={link.key} {...hover} accessibilityRole="button" accessibilityLabel={link.label+(count?`, ${count} new`:'')} accessibilityState={{selected:on}} onPress={()=>onOpen(link)} style={[ui.row,{minHeight:40,gap:12,paddingHorizontal:12,borderRadius:12,backgroundColor:on?p.wash:'transparent'}]}>
            {on&&<View style={{position:'absolute',left:-14,top:10,bottom:10,width:4,borderTopRightRadius:4,borderBottomRightRadius:4,backgroundColor:p.primary}}/>}
            <View style={{width:26,height:26,borderRadius:8,alignItems:'center',justifyContent:'center',backgroundColor:start?p.wash:'transparent'}}><Feather name={link.icon as Icon} size={16} color={on||start?p.primary:p.muted}/></View>
            <Text numberOfLines={1} style={{flex:1,fontSize:13,fontWeight:on?'700':'500',color:on?p.primary:start?p.primary:p.text}}>{link.label}</Text>
            {count>0&&<View style={{minWidth:22,height:20,paddingHorizontal:6,borderRadius:10,backgroundColor:p.badge,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:11,fontWeight:'800',color:p.onBadge}}>{count>99?'99+':count}</Text></View>}
          </MotionPress>;
        })}</View>
      </View>)}
    </ScrollView>
    <MotionPress {...hover} accessibilityRole="button" accessibilityLabel="Open profile and preferences" onPress={onProfile} style={[ui.row,{gap:12,margin:14,padding:12,borderRadius:18,borderWidth:1,borderColor:p.border,backgroundColor:p.surface}]}>
      <View style={{width:38,height:38,borderRadius:12,backgroundColor:p.header,alignItems:'center',justifyContent:'center'}}><Feather name="settings" size={17} color={p.headerText}/></View>
      <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{fontSize:13,fontWeight:'600',color:p.text}}>Profile</Text><Text numberOfLines={1} style={{fontSize:12,color:p.muted}}>Theme and sign out</Text></View>
      <Feather name="chevron-right" size={16} color={p.muted}/>
    </MotionPress>
  </View>;
}
