import { useMemo, useState } from 'react';
import { Animated, PanResponder, Platform, ScrollView, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Text } from './Typography';
import { Artwork } from './Artwork';
import { MotionPress, useReducedMotion } from './motion';
import { ui, type Palette } from './theme';
import type { FinderEntry } from '../../lib/tool-finder';
import type { Tool } from './model';
import { orderedPins } from '../../lib/pinned-tools';

const stride = 176;
type Props = {entries: FinderEntry<Tool>[]; saved:string[]; palette:Palette; onOpen:(tool:Tool)=>void; onMove:(key:string,target:number)=>void};
export function PinnedTools({entries,saved,palette:p,onOpen,onMove}:Props) {
  const pins=orderedPins(entries,saved);
  const [drag,setDrag]=useState<{key:string;from:number;to:number}|null>(null);
  const [offset]=useState(()=>new Animated.Value(0));
  const reduced=useReducedMotion();
  return <View style={{gap:8}}>
    <Text style={[ui.small,{color:p.muted}]}>Drag the grip to reorder, or use the move buttons.</Text>
    <ScrollView horizontal scrollEnabled={!drag} keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:12,paddingVertical:6}}>
      {pins.map((entry,index)=><Pin key={entry.key} entry={entry} index={index} count={pins.length} palette={p} onOpen={onOpen} onMove={onMove} offset={offset} drag={drag} reduced={reduced} onDrag={setDrag}/>)}
    </ScrollView>
    <Text accessibilityLiveRegion="polite" style={[ui.small,{color:p.muted}]}>{drag?'Move '+pins[drag.from]?.name+' to position '+(drag.to+1):`${pins.length} pinned ${pins.length===1?'tool':'tools'}`}</Text>
  </View>;
}
function Pin({entry,index,count,palette:p,onOpen,onMove,offset,drag,reduced,onDrag}:{
  entry:FinderEntry<Tool>;index:number;count:number;palette:Palette;onOpen:Props['onOpen'];onMove:Props['onMove'];offset:Animated.Value;drag:{key:string;from:number;to:number}|null;reduced:boolean;onDrag:(value:{key:string;from:number;to:number}|null)=>void;
}) {
  const gesture=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>true,
    onMoveShouldSetPanResponder:(_,state)=>Math.abs(state.dx)>4,
    onPanResponderGrant:()=>{offset.setValue(0);onDrag({key:entry.key,from:index,to:index});},
    onPanResponderMove:(_,state)=>{offset.setValue(state.dx);onDrag({key:entry.key,from:index,to:Math.max(0,Math.min(count-1,index+Math.round(state.dx/stride)))});},
    onPanResponderRelease:(_,state)=>{const target=Math.max(0,Math.min(count-1,index+Math.round(state.dx/stride)));offset.setValue(0);onDrag(null);if(target!==index)onMove(entry.key,target);},
    onPanResponderTerminate:()=>{offset.setValue(0);onDrag(null);},
    onPanResponderTerminationRequest:()=>false,
  }),[count,entry.key,index,offset,onDrag,onMove]);
  const dragging=drag?.key===entry.key;
  const shift=drag&&!dragging?(drag.from<index&&index<=drag.to?-stride:drag.to<=index&&index<drag.from?stride:0):0;
  return <Animated.View style={{width:164,borderRadius:22,borderWidth:1,borderColor:dragging?p.primary:p.border,backgroundColor:p.surface,zIndex:dragging?2:0,transform:[{translateX:dragging?offset:shift},{scale:dragging&&!reduced?1.02:1}],...(Platform.OS==='web'?{boxShadow:'0 8px 24px var(--rc-shadow)'}:{})}}>
    <MotionPress accessibilityRole="button" accessibilityLabel={'Open pinned '+entry.name} onPress={()=>onOpen(entry.tool)} style={{padding:16,gap:12,minHeight:132}}><Artwork id={entry.tool.id} size={40} palette={p}/><Text style={{color:p.text,fontSize:14,lineHeight:20,fontWeight:'500'}}>{entry.name}</Text></MotionPress>
    <View style={[ui.between,{borderTopWidth:1,borderColor:p.border,paddingHorizontal:8}]}>
      <MotionPress accessibilityRole="button" accessibilityLabel={'Move '+entry.name+' earlier'} disabled={index===0} accessibilityState={{disabled:index===0}} onPress={()=>onMove(entry.key,index-1)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="chevron-left" size={18} color={index===0?p.muted:p.primary}/></MotionPress>
      <View {...gesture.panHandlers} {...(Platform.OS==='web'?{dataSet:{pinGrip:'true'}}:{})} accessible accessibilityLabel={'Drag to reorder '+entry.name} accessibilityHint="Use the move buttons to change position without dragging" style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="more-vertical" size={20} color={p.muted}/></View>
      <MotionPress accessibilityRole="button" accessibilityLabel={'Move '+entry.name+' later'} disabled={index===count-1} accessibilityState={{disabled:index===count-1}} onPress={()=>onMove(entry.key,index+1)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Feather name="chevron-right" size={18} color={index===count-1?p.muted:p.primary}/></MotionPress>
    </View>
  </Animated.View>;
}
