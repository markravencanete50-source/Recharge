import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, BatteryFull, Check, RotateCcw, Signal, Smartphone, Wifi } from "lucide-react";
import { ThemeToggle } from "@/components/workspace-theme";
import type { WorkspaceRole } from "@/lib/modules";
import "./mobile-preview.css";

export const previewRoles: { value: WorkspaceRole; label: string }[] = [
  { value: "super_admin", label: "Super admin" }, { value: "admin", label: "Admin" },
  { value: "stays", label: "Stays team" }, { value: "cleans", label: "Cleaner" },
  { value: "cleaning_manager", label: "Cleaning manager" },
  { value: "ready", label: "Ready team" }, { value: "client", label: "Client" },
];
const devices = {
  iphone: { label: "iPhone", width: 390, height: 720 },
  android: { label: "Android", width: 412, height: 740 },
};

export function MobilePreview() {
  const [device, setDevice] = useState<keyof typeof devices>("iphone");
  const [role, setRole] = useState<WorkspaceRole>("super_admin");
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dimensions = devices[device];
  const frameWidth = dimensions.width + 20;
  const frameHeight = dimensions.height + 70;
  const screenUrl = `?embedded=1&role=${role}`;

  useEffect(() => {
    document.title = "Recharge | Mobile preview";
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => {
      const availableWidth = element.clientWidth - 48;
      const availableHeight = element.clientHeight - 40;
      setScale(fit ? Math.max(0.2, Math.min(1, availableWidth / frameWidth, availableHeight / frameHeight)) : 1);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [fit, frameWidth, frameHeight]);

  return <main className="phone-preview">
    <header className="phone-preview-header">
      <a href="?view=desktop" className="phone-preview-brand" aria-label="Back to Recharge desktop preview">RECHARGE<span>Product studio</span></a>
      <div className="phone-header-actions"><ThemeToggle /><a href="?view=desktop" className="phone-desktop-link">Desktop view <ArrowUpRight size={16} aria-hidden="true" /></a></div>
    </header>
    <section className="phone-preview-intro" aria-labelledby="mobile-preview-title">
      <div><p className="phone-eyebrow">MOBILE EXPERIENCE</p><h1 id="mobile-preview-title">Recharge in your hand.</h1><p>Explore the mobile layout. Open menus, browse departments and try the analytics calendar.</p></div>
      <span className="phone-preview-note"><span aria-hidden="true" />Interactive web preview</span>
    </section>
    <section className="phone-toolbar" aria-label="Mobile preview controls">
      <div className="phone-device-toggle" role="group" aria-label="Device size">
        {Object.entries(devices).map(([value, item]) => <button key={value} type="button" aria-pressed={device === value} onClick={() => setDevice(value as keyof typeof devices)}><Smartphone size={16} aria-hidden="true" />{item.label}</button>)}
      </div>
      <div className="phone-role-label"><label htmlFor="phone-preview-role">View as</label><select id="phone-preview-role" value={role} onChange={event => { setLoaded(false); setRole(event.target.value as WorkspaceRole); }}>{previewRoles.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div>
      <div className="phone-size-toggle" role="group" aria-label="Preview scale"><button type="button" aria-pressed={fit} onClick={() => setFit(true)}>Fit</button><button type="button" aria-pressed={!fit} onClick={() => setFit(false)}>100%</button></div>
      <button className="phone-reload" type="button" aria-label="Reload mobile preview" onClick={() => { setLoaded(false); setRevision(value => value + 1); }}><RotateCcw size={17} aria-hidden="true" /></button>
    </section>
    <div className={`phone-stage${fit ? " phone-stage-fit" : ""}`} ref={stage}>
      <div className="phone-footprint" style={{ width: frameWidth * scale, height: frameHeight * scale }}>
        <div className={`phone-frame phone-frame-${device}`} style={{ "--phone-width": `${dimensions.width}px`, "--phone-height": `${dimensions.height}px`, transform: `scale(${scale})` } as CSSProperties}>
          <div className="phone-side-button" aria-hidden="true" /><div className="phone-volume-buttons" aria-hidden="true" />
          <div className="phone-display">
            <div className="phone-status-bar" aria-hidden="true"><span>9:41</span><span className="phone-camera" /><div><Signal size={15} /><Wifi size={15} /><BatteryFull size={20} /></div></div>
            {!loaded && <div className="phone-loading" role="status">Opening Recharge...</div>}
            <iframe key={`${role}-${revision}`} src={screenUrl} title="Recharge mobile screen" onLoad={() => setLoaded(true)} />
            <div className="phone-gesture" aria-hidden="true"><span /></div>
          </div>
        </div>
      </div>
    </div>
    <footer className="phone-preview-footer"><span><Check size={14} aria-hidden="true" /> {dimensions.width} by {dimensions.height} mobile viewport</span><span>Sample data. Changes are disabled.</span><a href={screenUrl} target="_blank" rel="noopener noreferrer">Open app <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
  </main>;
}
