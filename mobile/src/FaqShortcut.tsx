import { useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
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
// A quiet floating pill in the corner: it never covers page content and
// clears the mobile dock.
export function FaqShortcut({palette:p,onOpen,onHide}:{palette:Palette;onOpen:()=>void;onHide:()=>void}) {
  const {width}=useWindowDimensions();
  const desktop=width>=1024;
  const shadow=Platform.OS==='web'?{boxShadow:'0 12px 30px -12px rgba(8, 22, 18, 0.55)'}:{elevation:6};
  // On phones a compact round button keeps charts and lists readable; it can
  // be turned off in Profile and preferences.
  if(!desktop)return <MotionPress accessibilityRole="button" accessibilityLabel="Open role FAQs" onPress={onOpen} style={{position:'absolute',right:16,bottom:118,zIndex:20,width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:p.header,borderWidth:1,borderColor:p.headerBorder,...shadow}}><Feather name="help-circle" size={20} color={p.headerText}/></MotionPress>;
  return <View style={{position:'absolute',right:24,bottom:44,zIndex:20,flexDirection:'row',alignItems:'center',gap:6}}>
    <MotionPress accessibilityRole="button" accessibilityLabel="Hide FAQ shortcut" onPress={onHide} style={{width:30,height:30,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:p.surface,borderWidth:1,borderColor:p.border}}><Feather name="x" size={14} color={p.muted}/></MotionPress>
    <MotionPress accessibilityRole="button" accessibilityLabel="Open role FAQs" onPress={onOpen} style={{flexDirection:'row',alignItems:'center',gap:8,minHeight:44,paddingLeft:14,paddingRight:16,borderRadius:22,backgroundColor:p.header,borderWidth:1,borderColor:p.headerBorder,...shadow}}><Feather name="help-circle" size={18} color={p.headerText}/><Text style={{color:p.headerText,fontSize:13,fontWeight:'600'}}>Help</Text></MotionPress>
  </View>;
}
