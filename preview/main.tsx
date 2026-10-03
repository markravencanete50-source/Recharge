import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RechargePortal } from "@/app/recharge-portal";
import { defaultModulesForRole, type WorkspaceRole } from "@/lib/modules";
import { accessUsers, properties, workflows, communications, maintenance, onboarding, cleans } from "./fixtures";
import "@/app/globals.css";
import "./preview.css";

function Preview() {
  const [role, setRole] = useState<WorkspaceRole>("admin");
  return <>
    <section className="preview-banner" aria-label="Preview information">
      <div><strong>Recharge product preview</strong><span>Sample data only. Changes are disabled. Live accounts and integrations are still being connected.</span></div>
      <label>View as <select value={role} onChange={event => setRole(event.target.value as WorkspaceRole)}>
        <option value="admin">Admin</option><option value="stays">Stays</option><option value="cleans">Cleans</option><option value="ready">Ready</option><option value="client">Client</option>
      </select></label>
    </section>
    <div className="preview-workspace"><RechargePortal key={role} preview
      currentUser={{ name: "Preview user", email: "preview@example.com", role, modules: defaultModulesForRole(role) }}
      accessUsers={accessUsers} propertyDatabaseData={properties} workflowData={workflows}
      communicationData={communications} maintenanceData={maintenance} onboardingData={{...onboarding, mode: role === "client" ? "client" : "staff"}}
      cleansData={cleans} signOutPath="/" />
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
