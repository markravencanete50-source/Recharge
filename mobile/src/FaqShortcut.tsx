import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { MotionPress } from './motion';
import { Text } from './Typography';
import type { Palette } from './theme';

export function useFaqShortcut() {
  const [hidden,setHidden]=useState(false),changed=useRef(false);
  useEffect(()=>{let active=true;AsyncStorage.getItem('recharge:faq-shortcut-hidden').then(value=>{if(active&&!changed.current)setHidden(value==='true');}).catch(()=>{});return()=>{active=false;};},[]);
  const update=(value:boolean)=>{changed.current=true;setHidden(value);void AsyncStorage.setItem('recharge:faq-shortcut-hidden',String(value)).catch(()=>{});};
  return {hidden,setHidden:update};
}
export function FaqShortcut({palette:p,onOpen,onHide}:{palette:Palette;onOpen:()=>void;onHide:()=>void}) {
  return <View style={{position:'absolute',left:0,top:'50%',marginTop:-54,width:44,zIndex:20,borderWidth:1,borderColor:p.success,borderTopRightRadius:14,borderBottomRightRadius:14,backgroundColor:p.successWash,overflow:'hidden'}}>
    <MotionPress accessibilityRole="button" accessibilityLabel="Open role FAQs" onPress={onOpen} style={{width:44,minHeight:64,alignItems:'center',justifyContent:'center',gap:4}}><Feather name="help-circle" size={18} color={p.success}/><Text style={{color:p.success,fontSize:12,fontWeight:'600'}}>FAQ</Text></MotionPress>
    <MotionPress accessibilityRole="button" accessibilityLabel="Hide FAQ shortcut" onPress={onHide} style={{width:44,minHeight:44,alignItems:'center',justifyContent:'center',borderTopWidth:1,borderTopColor:p.success}}><Feather name="x" size={16} color={p.success}/></MotionPress>
  </View>;
}
