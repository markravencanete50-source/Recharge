import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { MotionPress, motionTokens, useReducedMotion } from './motion';
import { Text } from './Typography';
import { depth, ui, web, type Palette } from './theme';
import { CompanyLogo } from './CompanyLogo';
import type { PanelGroup, PanelLink, RolePanel } from '../../lib/role-panel';

type Icon = keyof typeof Feather.glyphMap;
const hover=Platform.OS==='web'?{dataSet:{hover:'tint'}}:{};
const native=Platform.OS!=='web';

// One group of links. The highlight glides from link to link inside the group, and fades across
// when the selection moves to another group.
function Group({group,selected,palette:p,badges,onOpen}:{group:PanelGroup;selected:string;palette:Palette;badges:Record<string,number>;onOpen:(link:PanelLink)=>void}) {
  const reduced=useReducedMotion();
  const [boxes,setBoxes]=useState<Record<string,{y:number;h:number}>>({});
  const box=boxes[selected];
  const [y]=useState(()=>new Animated.Value(0)),[h]=useState(()=>new Animated.Value(40)),[shown]=useState(()=>new Animated.Value(0));
  const visible=useRef(false);
  useEffect(()=>{
    if(!box){visible.current=false;if(reduced)shown.setValue(0);else Animated.timing(shown,{toValue:0,duration:motionTokens.ui,useNativeDriver:false}).start();return;}
    if(reduced||!visible.current){y.setValue(box.y);h.setValue(box.h);}
    else Animated.parallel([Animated.spring(y,{toValue:box.y,speed:18,bounciness:4,useNativeDriver:false}),Animated.spring(h,{toValue:box.h,speed:18,bounciness:4,useNativeDriver:false})]).start();
    visible.current=true;
    if(reduced)shown.setValue(1);else Animated.timing(shown,{toValue:1,duration:motionTokens.ui,easing:motionTokens.entrance,useNativeDriver:false}).start();
  },[box,reduced,y,h,shown]);
  return <View style={{marginTop:18}}>
    <View style={[ui.row,{gap:10,paddingHorizontal:12,marginBottom:6}]}>
      <Text accessibilityRole="header" style={[ui.label,{color:p.muted}]}>{group.title}</Text>
      <View style={{flex:1,height:1,backgroundColor:p.border}}/>
    </View>
    <View style={{gap:2}}>
      <Animated.View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:y,height:h,borderRadius:12,backgroundColor:p.wash,opacity:shown,...web({boxShadow:'inset 0 1px 0 rgba(255,255,255,.5)'})}}>
        <View style={{position:'absolute',left:-14,top:9,bottom:9,width:4,borderTopRightRadius:4,borderBottomRightRadius:4,backgroundColor:p.primary}}/>
      </Animated.View>
      {group.links.map(link=>{
        const on=link.key===selected,count=badges[link.key]??0,start=link.kind==='start';
        return <MotionPress key={link.key} {...(on?{}:hover)} onLayout={event=>{const {y:top,height}=event.nativeEvent.layout;setBoxes(b=>b[link.key]?.y===top&&b[link.key]?.h===height?b:{...b,[link.key]:{y:top,h:height}});}}
          accessibilityRole="button" accessibilityLabel={link.label+(count?`, ${count} new`:'')} accessibilityState={{selected:on}} onPress={()=>onOpen(link)}
          style={[ui.row,{minHeight:40,gap:12,paddingHorizontal:12,borderRadius:12}]}>
          <View style={{width:28,height:28,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:on?p.surface:start?p.wash:'transparent',...(on?web({boxShadow:'0 4px 10px -6px rgba(21,45,40,.45)'}):{})}}>
            <Feather name={link.icon as Icon} size={15} color={on||start?p.primary:p.muted}/>
          </View>
          <Text numberOfLines={1} style={{flex:1,fontSize:13,fontWeight:on?'700':'500',color:on||start?p.primary:p.text}}>{link.label}</Text>
          {count>0&&<View style={{minWidth:22,height:20,paddingHorizontal:6,borderRadius:10,backgroundColor:p.badge,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:11,fontWeight:'800',color:p.onBadge}}>{count>99?'99+':count}</Text></View>}
        </MotionPress>;
      })}
    </View>
  </View>;
}

// The role's card at the top of the panel: forest, with a slow drifting light behind the heading.
function RoleCard({panel,palette:p,viewing,onBack,backLabel='Back to my view'}:{panel:RolePanel;palette:Palette;viewing?:{name:string;detail:string}|null;onBack?:()=>void;backLabel?:string}) {
  const reduced=useReducedMotion();
  const [drift]=useState(()=>new Animated.Value(0));
  useEffect(()=>{
    if(reduced){drift.setValue(0);return;}
    const loop=Animated.loop(Animated.sequence([Animated.timing(drift,{toValue:1,duration:7000,useNativeDriver:native}),Animated.timing(drift,{toValue:0,duration:7000,useNativeDriver:native})]));
    loop.start();return()=>loop.stop();
  },[drift,reduced]);
  return <View testID="sidebar-role" accessibilityRole="header" accessibilityLabel={(viewing?`${viewing.name}. `:'')+panel.title+' workspace. '+panel.tagline}
    style={{borderRadius:20,overflow:'hidden',backgroundColor:p.hero,padding:14,gap:10,...depth.raised,...web({backgroundImage:'linear-gradient(145deg,#2A5248 0%,#1F3D38 55%,#17302B 100%)'})}}>
    <Animated.View pointerEvents="none" style={{position:'absolute',right:-70,top:-80,transform:[{translateX:drift.interpolate({inputRange:[0,1],outputRange:[0,-26]})},{translateY:drift.interpolate({inputRange:[0,1],outputRange:[0,18]})}]}}>
      <Svg width={200} height={200}><Defs><RadialGradient id="role-card-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#A7D9C1" stopOpacity={0.42}/><Stop offset="1" stopColor="#A7D9C1" stopOpacity={0}/></RadialGradient></Defs><Circle cx={100} cy={100} r={100} fill="url(#role-card-glow)"/></Svg>
    </Animated.View>
    <View style={[ui.row,{gap:11}]}>
      <View style={{width:38,height:38,borderRadius:12,backgroundColor:'rgba(255,255,255,0.12)',borderWidth:1,borderColor:'rgba(255,255,255,0.18)',alignItems:'center',justifyContent:'center'}}><Feather name={panel.icon as Icon} size={17} color="#FFFFFF"/></View>
      <View style={{flex:1,minWidth:0}}>
        <Text numberOfLines={1} style={{fontSize:15,fontWeight:'800',color:'#FFFFFF',letterSpacing:-0.2}}>{panel.title}</Text>
        <Text numberOfLines={2} style={{fontSize:11,lineHeight:15,color:'rgba(255,255,255,0.78)'}}>{panel.tagline}</Text>
      </View>
    </View>
    {!!viewing&&<View style={{gap:8,paddingTop:10,borderTopWidth:1,borderColor:'rgba(255,255,255,0.14)'}}>
      <View style={[ui.row,{gap:6}]}><Feather name="eye" size={13} color="#A7D9C1"/><Text numberOfLines={1} style={{flex:1,fontSize:12,fontWeight:'700',color:'#FFFFFF'}}>{viewing.name}</Text></View>
      <Text style={{fontSize:11,lineHeight:15,color:'rgba(255,255,255,0.78)'}}>{viewing.detail}</Text>
      {!!onBack&&<MotionPress accessibilityRole="button" onPress={onBack} style={[ui.row,{justifyContent:'center',gap:6,minHeight:36,borderRadius:999,backgroundColor:'#FFFFFF'}]}><Feather name="corner-up-left" size={14} color="#1F3D38"/><Text style={{fontSize:12,fontWeight:'700',color:'#1F3D38'}}>{backLabel}</Text></MotionPress>}
    </View>}
  </View>;
}

// The live workspace's desktop left panel: the role's own heading and groups (lib/role-panel.ts).
// While a super admin views as someone, it is that person's or role's panel, marked as a view.
export function RoleNavigation({panel,selected,palette:p,onOpen,onProfile,onCollapse,badges={},viewing,onBack,backLabel}:{
  panel:RolePanel;selected:string;palette:Palette;onOpen:(link:PanelLink)=>void;onProfile:()=>void;onCollapse:()=>void;
  badges?:Record<string,number>;viewing?:{name:string;detail:string}|null;onBack?:()=>void;backLabel?:string;
}) {
  return <View testID="workspace-sidebar" style={{width:264,backgroundColor:p.isDark?p.surface:p.background,borderRightWidth:1,borderColor:p.border}}>
    <View testID="sidebar-brand" style={[ui.between,{height:81,paddingHorizontal:16,gap:12,backgroundColor:p.header,borderBottomWidth:1,borderColor:p.isDark?p.border:p.header}]}><CompanyLogo palette={p} width={144}/><MotionPress accessibilityRole="button" accessibilityLabel="Hide left panel" accessibilityState={{expanded:true}} onPress={onCollapse} style={[ui.iconButton,{width:44,height:44,borderRadius:14,backgroundColor:p.headerControl,borderColor:p.headerBorder}]}><Feather name="chevrons-left" size={18} color={p.headerControlText}/></MotionPress></View>
    <ScrollView contentContainerStyle={{paddingHorizontal:14,paddingTop:16,paddingBottom:24}} showsVerticalScrollIndicator={false}>
      <RoleCard panel={panel} palette={p} viewing={viewing} onBack={onBack} backLabel={backLabel}/>
      {panel.groups.map(group=><Group key={group.title} group={group} selected={selected} palette={p} badges={badges} onOpen={onOpen}/>)}
    </ScrollView>
    <MotionPress {...hover} accessibilityRole="button" accessibilityLabel="Open profile and preferences" onPress={onProfile} style={[ui.row,{gap:12,margin:14,padding:12,borderRadius:18,borderWidth:1,borderColor:p.border,backgroundColor:p.surface,...depth.card}]}>
      <View style={{width:38,height:38,borderRadius:12,backgroundColor:p.header,alignItems:'center',justifyContent:'center'}}><Feather name="settings" size={17} color={p.headerText}/></View>
      <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={{fontSize:13,fontWeight:'600',color:p.text}}>Profile</Text><Text numberOfLines={1} style={{fontSize:12,color:p.muted}}>Theme and sign out</Text></View>
      <Feather name="chevron-right" size={16} color={p.muted}/>
    </MotionPress>
  </View>;
}
