import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether the Help button shows. It sits in the header on wide screens (LiveWorkspace) and in the Menu on
// phones; it no longer floats over the page, where it covered the last button in a row.
export function useFaqShortcut() {
  const [hidden,setHidden]=useState(false),changed=useRef(false);
  useEffect(()=>{let active=true;AsyncStorage.getItem('recharge:faq-shortcut-hidden').then(value=>{if(active&&!changed.current)setHidden(value==='true');}).catch(()=>{});return()=>{active=false;};},[]);
  const update=(value:boolean)=>{changed.current=true;setHidden(value);void AsyncStorage.setItem('recharge:faq-shortcut-hidden',String(value)).catch(()=>{});};
  return {hidden,setHidden:update};
}
