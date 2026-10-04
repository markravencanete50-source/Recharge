"use client";
import { useEffect, useRef, useState } from 'react';
import { Search,ArrowUpRight } from 'lucide-react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { ToolIllustration } from '@/components/tool-illustration';
import { Input } from '@/components/ui/input';
import { findTools,titleParts } from '@/lib/tool-finder';
import { WORKSPACE_MAP } from '@/lib/workspace-map';
import type { MODULES } from '@/lib/modules';
type Tool=(typeof MODULES)[number];
export function WorkspaceCommand({open,onOpenChange,tools,onSelect,onReports}:{open:boolean;onOpenChange:(open:boolean)=>void;tools:Tool[];onSelect:(tool:Tool)=>void;onReports:()=>void}) {
  const [query,setQuery]=useState(''),[selected,setSelected]=useState(0);
  const input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const entries=tools.map(tool=>({key:tool.id,name:tool.name,tone:WORKSPACE_MAP[tool.id].tone,tool}));
  const found=findTools(entries,query);
  const rows=['stays','ready','cleans','clients','accounts'].flatMap(tone=>found.filter(entry=>entry.tone===tone));
  const reports='Reports and analytics'.toLowerCase().includes(query.trim().toLowerCase());
  const actions=[...(reports?[{key:'reports',name:'Reports and analytics',run:onReports}]:[]),...rows.map(entry=>({key:entry.key,name:entry.name,run:()=>onSelect(entry.tool)}))];
  useEffect(()=>{if(!open)return;const listener=(event:KeyboardEvent)=>{
    if(document.activeElement!==input.current)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const next=actions.length?(selected+(event.key==='ArrowDown'?1:-1)+actions.length)%actions.length:0;setSelected(next);list.current?.querySelector('[data-command-key="'+actions[next]?.key+'"]')?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'){event.preventDefault();const action=actions[selected];if(action){onOpenChange(false);action.run();}}
  };document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);});
  return <Dialog open={open} onOpenChange={value=>{onOpenChange(value);if(!value){setQuery('');setSelected(0);}}}><DialogContent className="workspace-command" onOpenAutoFocus={event=>{event.preventDefault();input.current?.focus();}}><DialogTitle>Quick search</DialogTitle><DialogDescription>Search feature titles within your access.</DialogDescription><div className="command-input"><Search size={20} aria-hidden="true"/><Input ref={input} aria-label="Quick search feature titles" placeholder="Where do you want to go?" value={query} onChange={event=>{setQuery(event.target.value);setSelected(0);}}/></div><p className="command-hint" role="status">{rows.length} matching tools. {actions[selected]?'Selected: '+actions[selected].name:'No tool matches. Try a shorter word.'}</p><div className="command-results" ref={list}>{actions.map((action,index)=>{
    const tool=rows.find(entry=>entry.key===action.key);const department=tool?tool.tone:'Quick access';const previous=actions[index-1];const previousTone=previous&&rows.find(entry=>entry.key===previous.key)?.tone;
    return <div key={action.key}>{index===0||department!==previousTone?<p className="command-group">{department.charAt(0).toUpperCase()+department.slice(1)}</p>:null}<button data-command-key={action.key} type="button" className="command-result" data-selected={index===selected} aria-label={'Go to '+action.name} onClick={()=>{onOpenChange(false);action.run();}}>{tool?<ToolIllustration id={tool.tool.id}/>:<Search size={22} aria-hidden="true"/>}<span>{titleParts(action.name,query).map((part,i)=>part.match?<mark key={i}>{part.text}</mark>:part.text)}</span><ArrowUpRight size={18} aria-hidden="true"/></button></div>;
  })}</div><p className="command-hint">Arrow keys to select. Enter to open. Escape to close.</p></DialogContent></Dialog>;
}
