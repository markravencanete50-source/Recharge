"use client";
import { useEffect, useState, useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
let sessionPreference = false;
function subscribe(callback: () => void) {
  listeners.add(callback);
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  window.addEventListener('storage', callback);
  return () => { listeners.delete(callback); media.removeEventListener('change', callback); window.removeEventListener('storage', callback); };
}
function preference() { try { return localStorage.getItem('recharge:reduce-motion') === 'true'; } catch { return sessionPreference; } }
export function useWorkspaceMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || preference(), () => true);
}
export function ReduceMotionToggle() {
  const reduced = useWorkspaceMotion();
  return <button type="button" className="reduce-motion-control" role="switch" aria-checked={reduced} onClick={() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    sessionPreference = !preference();
    try { localStorage.setItem('recharge:reduce-motion', String(sessionPreference)); } catch { /* Retain the session setting if storage is unavailable. */ }
    document.documentElement.dataset.reduceMotion = String(sessionPreference);
    listeners.forEach(fn => fn());
  }}>Reduce motion <span aria-hidden="true">{reduced ? 'On' : 'Off'}</span></button>;
}
export function MotionPreferenceSync() {
  const reduced = useWorkspaceMotion();
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(reduced); }, [reduced]);
  return null;
}
export function Count({ value, motionKey }: {value: number | null; motionKey: string}) {
  const reduced = useWorkspaceMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value === null || reduced || seenCounts.has(motionKey)) { queueMicrotask(() => setShown(value)); return; }
    seenCounts.add(motionKey);
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => { const t = Math.min(1, (now - start) / 500); setShown(Math.round(value * (1 - Math.pow(1 - t, 3)))); if (t < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [value, reduced, motionKey]);
  return <span aria-label={value === null ? 'Not connected' : value.toLocaleString('en-GB')}><span aria-hidden="true">{shown === null ? '-' : shown?.toLocaleString('en-GB')}</span></span>;
}
const seenCounts = new Set<string>();
