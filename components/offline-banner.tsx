"use client";
import {useEffect,useState} from 'react';
export function OfflineBanner() {
  const [offline,setOffline]=useState(false);
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);update();window.addEventListener('offline',update);window.addEventListener('online',update);return()=>{window.removeEventListener('offline',update);window.removeEventListener('online',update);};},[]);
  return offline?<div className="workspace-offline" role="alert">You are offline. Check your connection before retrying a live request. Your entered information stays on this screen.</div>:null;
}
