import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RechargePortal } from "@/app/recharge-portal";
import { WorkspaceTheme } from "@/components/workspace-theme";
import { defaultModulesForRole, type WorkspaceRole } from "@/lib/modules";
import { accessUsers, properties, workflows, communications, maintenance, onboarding, cleans } from "./fixtures";
import { scopeAnalytics } from "@/lib/analytics";
import { MobilePreview, previewRoles } from "./mobile-preview";
import "@/app/globals.css";
import "./preview.css";

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embedded") === "1";
  const requestedRole = params.get("role");
  const [role, setRole] = useState<WorkspaceRole>(previewRoles.some(item => item.value === requestedRole) ? requestedRole as WorkspaceRole : "super_admin");
  const banner = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = banner.current;
    if (!element) { document.documentElement.style.setProperty("--preview-bar-height", "0px"); return; }
    const resize = () => document.documentElement.style.setProperty("--preview-bar-height", `${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--preview-bar-height"); };
  }, []);
  return <>
    {!embedded && <section ref={banner} className="preview-banner" aria-label="Preview information">
      <div><strong>Recharge product preview</strong><span>Sample data only. Changes are disabled. Live accounts and integrations are still being connected.</span></div>
      <div className="preview-actions"><a className="preview-phone-link" href="?view=phone">Mobile preview</a><label>View as <select value={role} onChange={event => setRole(event.target.value as WorkspaceRole)}>
        <option value="super_admin">Super admin</option><option value="admin">Admin</option><option value="stays">Stays</option><option value="cleans">Cleans</option><option value="ready">Ready</option><option value="client">Client</option>
      </select></label></div>
    </section>}
    <div className="preview-workspace"><RechargePortal key={role} preview
      currentUser={{ name: "Preview user", email: role === "cleans" ? "cleaner@example.com" : "preview@example.com", role, modules: defaultModulesForRole(role) }}
      accessUsers={accessUsers} propertyDatabaseData={properties} workflowData={workflows}
      communicationData={communications} maintenanceData={maintenance} onboardingData={{...onboarding, mode: role === "client" ? "client" : "staff"}}
      cleansData={cleans} analyticsData={scopeAnalytics({ email: role === "cleans" ? "cleaner@example.com" : "preview@example.com", role, modules: defaultModulesForRole(role) }, {workflows, maintenance, cleans, onboarding, properties})} signOutPath={embedded ? `?embedded=1&role=${role}` : "/"} />
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><WorkspaceTheme>{new URLSearchParams(window.location.search).get("view") === "phone" ? <MobilePreview /> : <Preview />}</WorkspaceTheme></StrictMode>);
