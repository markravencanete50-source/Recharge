import type { HomeToolTarget } from "../../lib/home-tools";
import type { JourneyView, OperationView, WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";
import type { Palette } from "./theme";

// What every section list in the Work area (Guest relations, Client relations, Maintenance...) is
// given by the screen that mounts it, so each list can be dropped into any host unchanged.
export type SectionProps = {
  palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[];
  onForm: (f: WorkflowForm) => void; onOpenWork: (w: OperationView) => void; onTool: (t: HomeToolTarget) => void;
};
