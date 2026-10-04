"use client";
import { isWorkspaceAdmin } from "@/lib/modules";


import { FormEvent, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ToolIllustration } from "@/components/tool-illustration";
import { DepartmentIllustration } from "@/components/department-illustration";
import { ThemeToggle } from "@/components/workspace-theme";
import { AnalyticsBoard } from "@/app/analytics-board";
import { scopeAnalytics, type AnalyticsSnapshot } from "@/lib/analytics";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Calculator,
  Check,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  Home,
  Landmark,
  Leaf,
  ListChecks,
  Menu,
  MessageSquare,
  PackageCheck,
  Play,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Sofa,
  UserRoundCog,
  UserRoundCheck,
  Users,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  MODULES,
  defaultModulesForRole,
  type AccessStatus,
  type ModuleId,
  type WorkspaceRole,
} from "@/lib/modules";
import type { MyRechargeData } from "@/lib/my-recharge";
import { WorkflowPanels } from "@/app/workflow-panels";
import type { WorkflowData } from "@/lib/workflows";
import { CommunicationCentre } from "@/app/communication-centre";
import { GuestMessageNotifier } from "@/app/guest-message-notifier";
import type { CommunicationCentreData } from "@/lib/communications";
import {
  MaintenanceCentre,
  type MaintenanceWorkspace,
} from "@/app/maintenance-centre";
import type { MaintenanceData } from "@/lib/maintenance-types";
import { PropertyDatabase } from "@/app/property-database";
import type { PropertyDatabaseData } from "@/lib/property-database";
import { OnboardingCentre } from "@/app/onboarding-centre";
import { NotificationCentre } from "@/app/notification-centre";
import type { OnboardingData } from "@/lib/onboarding-types";
import { ClientWorkspace } from "@/app/client-workspace";
import { CleansCentre, type CleansMode } from "@/app/cleans-centre";
import type { CleansData } from "@/lib/cleans-types";
import {
  PurchaseOrderCentre,
  type PurchaseOrderWorkspace,
} from "@/app/purchase-order-centre";
import { OperationsCentre, type OperationsMode } from "@/app/operations-centre";
import { WorkflowToolBoard, type WorkflowToolMode } from "@/app/workflow-tool-board";
import { TeamClient } from "@/app/team/team-client";
import { OwnerStatementsCentre } from "@/app/owner-statements-centre";

type Role = WorkspaceRole;
const PreviewContext = createContext(false);
const ActorRoleContext = createContext<Role>("client");
type OperationsView =
  | "cleans"
  | "ready"
  | "stays"
  | "clients"
  | "accounts"
  | "marketing";
type View =
  | "overview"
  | "analytics"
  | "tools"
  | "my-recharge"
  | OperationsView
  | "communications"
  | "maintenance"
  | "property-database"
  | "onboarding"
  | "client-properties"
  | "client-calendar"
  | "cleans-centre"
  | "purchase-orders"
  | "operations-centre"
  | "owner-statements"
  | "onboarding-invoices-board"
  | "new-property-inspections-board"
  | "workflow-board"
  | "team"
  | "access";
type Module = (typeof MODULES)[number];
type ModuleCard = Omit<Module, "name" | "shortName" | "description"> & { name: string; shortName: string; description: string };

type CurrentUser = {
  name: string;
  email: string;
  role: Role;
  modules: ModuleId[];
};

type AccessUser = {
  email: string;
  fullName: string;
  responsibilities: string;
  role: Role;
  modules: ModuleId[];
  status: AccessStatus;
};

const icons = {
  "daily-pricing": BarChart3,
  "listing-health": Activity,
  "client-furnishing": Calculator,
  "safety-maintenance": ClipboardCheck,
  "purchase-order": PackageCheck,
  "purchase-order-requests": PackageCheck,
  "client-purchase-order-quotes": PackageCheck,
  "property-database": Building2,
  "property-onboarding": ClipboardCheck,
  "client-dashboard": Users,
  "client-property-maintenance": Wrench,
  "weekly-performance": BarChart3,
  "maintenance-reporting": Wrench,
  "stays-maintenance-reporting": Wrench,
  "clean-reporting": SprayCan,
  "aircover-reporting": ShieldCheck,
  "cleaning-schedule": CalendarDays,
  "cleaner-performance": Gauge,
  "clean-client-database": Users,
  "cleaner-database": UserRoundCheck,
  "cleans-invoices": ReceiptText,
  "client-mailbox": MessageSquare,
  "replenishment-requests": PackageCheck,
  "ready-schedule": CalendarDays,
  licensing: Landmark,
  "direct-bookings": ListChecks,
  "ota-logins": ShieldCheck,
  "guest-communication": MessageSquare,
  "property-furnishing-board": Sofa,
  "new-property-inspection-board": ClipboardCheck,
  "routine-bin-garden-board": Leaf,
  "clean-property-onboarding": SprayCan,
  "maintenance-reconciliation": ReceiptText,
  "onboarding-invoices": ReceiptText,
  "purchase-order-invoices": ReceiptText,
  "purchase-order-accounts": ReceiptText,
  "owner-statements": WalletCards,
};

const liveInternalModules = new Set<ModuleId>([
  "daily-pricing",
  "listing-health",
  "weekly-performance",
  "ready-schedule",
  "direct-bookings",
  "property-onboarding",
  "maintenance-reporting",
  "property-furnishing-board",
  "new-property-inspection-board",
  "routine-bin-garden-board",
  "clean-property-onboarding",
  "guest-communication",
  "aircover-reporting",
  "maintenance-reconciliation",
  "property-database",
  "clean-client-database",
  "cleaner-database",
  "cleaning-schedule",
  "cleaner-performance",
  "clean-property-onboarding",
  "cleans-invoices",
  "clean-reporting",
  "client-mailbox",
  "replenishment-requests",
  "client-property-maintenance",
  "purchase-order",
  "purchase-order-requests",
  "client-purchase-order-quotes",
  "purchase-order-invoices",
  "purchase-order-accounts",
  "owner-statements",
]);

const roleLabels: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  stays: "Stays employee",
  cleans: "Cleaner",
  cleaning_manager: "Cleaning manager",
  ready: "Ready employee",
  client: "Client",
};

const operationsSections = [
  {
    id: "cleans",
    label: "Cleans",
    description: "Recharge Cleans clients, schedules and business performance.",
    icon: SprayCan,
    modules: [
      "clean-client-database",
      "cleaner-database",
      "cleaning-schedule",
      "cleaner-performance",
      "clean-property-onboarding",
      "cleans-invoices",
    ] as ModuleId[],
  },
  {
    id: "ready",
    label: "Ready",
    description: "Recharge Ready furnishing, inspections and maintenance operations.",
    icon: PackageCheck,
    modules: [
      "ready-schedule",
      "safety-maintenance",
      "new-property-inspection-board",
      "purchase-order",
      "maintenance-reporting",
    ] as ModuleId[],
  },
  {
    id: "stays",
    label: "Stays",
    description: "Recharge Stays pricing, property performance and management reporting.",
    icon: Home,
    modules: [
      "guest-communication",
      "property-database",
      "property-onboarding",
      "listing-health",
      "daily-pricing",
      "weekly-performance",
      "licensing",
      "direct-bookings",
      "ota-logins",
      "stays-maintenance-reporting",
      "clean-reporting",
      "purchase-order-requests",
    ] as ModuleId[],
  },
  {
    id: "clients",
    label: "Clients",
    description:
      "Client portfolios, performance and the client-facing property onboarding journey.",
    icon: Users,
    modules: [
      "client-dashboard",
      "client-property-maintenance",
      "property-onboarding",
      "client-furnishing",
      "client-mailbox",
      "client-purchase-order-quotes",
    ] as ModuleId[],
  },
  {
    id: "accounts",
    label: "Accounts",
    description: "Financial records, owner reporting and accounting tools.",
    icon: Landmark,
    modules: [
      "owner-statements",
      "maintenance-reconciliation",
      "onboarding-invoices",
      "direct-bookings",
      "purchase-order-invoices",
      "purchase-order-accounts",
      "replenishment-requests",
    ] as ModuleId[],
  },
] as const;

export function RechargePortal({
  currentUser,
  accessUsers,
  myRecharge,
  workflowData,
  communicationData,
  maintenanceData,
  propertyDatabaseData,
  onboardingData,
  cleansData,
  signOutPath,
  analyticsData,
  preview = false,
}: {
  currentUser: CurrentUser;
  accessUsers: AccessUser[];
  myRecharge?: MyRechargeData;
  workflowData?: WorkflowData;
  communicationData?: CommunicationCentreData;
  maintenanceData?: MaintenanceData;
  propertyDatabaseData?: PropertyDatabaseData;
  onboardingData?: OnboardingData;
  cleansData?: CleansData;
  signOutPath: string;
  analyticsData?: AnalyticsSnapshot;
  preview?: boolean;
}) {
  const [view, setView] = useState<View>(currentUser.role === "super_admin" ? "analytics" : defaultDepartment(currentUser.role));
  const [cleansMode, setCleansMode] = useState<CleansMode>("cleaning-schedule");
  const [onboardingMode, setOnboardingMode] = useState<"client" | "staff">(
    currentUser.role === "client" ? "client" : "staff",
  );
  const [maintenanceWorkspace, setMaintenanceWorkspace] =
    useState<MaintenanceWorkspace>("stays");
  const [purchaseOrderWorkspace, setPurchaseOrderWorkspace] =
    useState<PurchaseOrderWorkspace>("ready");
  const [operationsMode, setOperationsMode] = useState<OperationsMode>("ready-calendar");
  const [menuOpen, setMenuOpen] = useState(false);
  const [workflowBoardMode, setWorkflowBoardMode] = useState<WorkflowToolMode>("new-property-inspections");
  const navigationRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const returnFocus = menuTriggerRef.current;
    document.body.style.overflow = "hidden";
    const items = () => Array.from(navigationRef.current?.querySelectorAll<HTMLElement>("button, a[href], input, select, [tabindex='0']") || []).filter(item => item.getClientRects().length > 0);
    items()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key === "Tab") {
        const controls = items();
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resized = () => { if (desktop.matches) setMenuOpen(false); };
    document.addEventListener("keydown", keydown);
    desktop.addEventListener("change", resized);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      desktop.removeEventListener("change", resized);
      returnFocus?.focus();
    };
  }, [menuOpen]);
  const visibleModules = useMemo(
    () => MODULES.filter((module) => currentUser.modules.includes(module.id)),
    [currentUser.modules],
  );
  const visibleOperationsSections = useMemo(
    () =>
      operationsSections.filter((section) =>
        section.modules.some((moduleId) => currentUser.modules.includes(moduleId)),
      ),
    [currentUser.modules],
  );

  function changeView(next: View) {
    setView(next);
    setMenuOpen(false);
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function openMaintenance(workspace: MaintenanceWorkspace) {
    setMaintenanceWorkspace(workspace);
    setView("maintenance");
    setMenuOpen(false);
  }

  function openOnboarding(mode: "client" | "staff") {
    setOnboardingMode(mode);
    setView("onboarding");
    setMenuOpen(false);
  }

  function openCleans(mode: CleansMode) {
    setCleansMode(mode);
    setView("cleans-centre");
    setMenuOpen(false);
  }

  function openPurchaseOrders(workspace: PurchaseOrderWorkspace) {
    setPurchaseOrderWorkspace(workspace);
    setView("purchase-orders");
    setMenuOpen(false);
  }

  function openOperations(mode: OperationsMode) {
    setOperationsMode(mode);
    setView("operations-centre");
    setMenuOpen(false);
  }

  return (
    <PreviewContext.Provider value={preview}><ActorRoleContext.Provider value={currentUser.role}>
    <div className="recharge-workspace min-h-screen text-[var(--foreground)]">
      <GuestMessageNotifier
        enabled={!preview && currentUser.modules.includes("guest-communication") && currentUser.role !== "client"}
        paused={view === "communications"}
        initialData={communicationData}
        onOpen={() => changeView("communications")}
      />
      {menuOpen && <button className="navigation-backdrop lg:hidden" aria-label="Dismiss navigation" onClick={() => setMenuOpen(false)} tabIndex={-1} />}
      <aside ref={navigationRef} id="workspace-navigation" role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen ? true : undefined} aria-label="Workspace navigation" className={"sidebar " + (menuOpen ? "sidebar-open" : "")}>
        <div className="sidebar-brand flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-5 lg:border-0">
          <button
            className="flex items-center gap-3 text-left"
            onClick={() =>
              changeView(defaultDepartment(currentUser.role))
            }
          >
            <span>
              <img
                src="/recharge-wordmark.svg"
                alt="Recharge"
                className="h-auto w-[9.8rem]"
              />
              <span className="mt-2 block text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-white/45">
                Workspace
              </span>
            </span>
          </button>
          <button
            className="grid size-11 place-items-center rounded-lg text-white/70 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav
          className="sidebar-navigation min-h-0 flex-1 overflow-y-auto px-4 pb-3"
          aria-label="Workspace"
        >
          {currentUser.role === "stays" && myRecharge && (
          <div className="space-y-2">
            <p className="px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/30">Personal</p>
              <NavButton
                active={view === "my-recharge"}
                icon={UserRoundCheck}
                index="01"
                label="My Recharge"
                onClick={() => changeView("my-recharge")}
              />
          </div>
          )}

          <div className={`${currentUser.role === "stays" ? "mt-7" : ""} space-y-2`}>
            <p className="px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/30">
              Departments
            </p>
            {visibleOperationsSections.map((section, index) => (
              <NavButton
                active={view === section.id}
                icon={section.icon}
                index={String(index + 1 + (currentUser.role === "stays" ? 1 : 0)).padStart(2, "0")}
                key={section.id}
                label={section.label}
                onClick={() => changeView(section.id)}
              />
            ))}
          </div>

          {currentUser.role !== "client" && (
            <div className="mt-7 space-y-2">
              <p className="px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/30">Company</p>
              <NavButton
                active={view === "team"}
                icon={Users}
                index="06"
                label="Team"
                onClick={() => changeView("team")}
              />
            </div>
          )}

          <div className="mt-4 space-y-1"><NavButton active={view === "analytics"} icon={BarChart3} index="07" label="Analytics" onClick={() => changeView("analytics")} /></div>

          {isWorkspaceAdmin(currentUser.role) && (
            <div className="mt-7 space-y-2">
              <p className="px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white/30">
                Administration
              </p>
              <NavButton
                active={view === "access"}
                icon={UserRoundCog}
                index="08"
                label="Access"
                onClick={() => changeView("access")}
              />
            </div>
          )}
        </nav>

        <div className="sidebar-footer shrink-0 border-t border-white/10 px-6 py-4">
          <p className="truncate text-sm font-semibold text-white">
            {currentUser.name}
          </p>
          <p className="mt-1 truncate text-xs text-white/45">
            {roleLabels[currentUser.role]}
          </p>
          <a
            className="mt-4 inline-flex text-sm font-medium text-[var(--muted-foreground)] hover:text-white"
            href={signOutPath}
          >
            Sign out
          </a>
        </div>
      </aside>

      <main className="lg:pl-[17rem]">
        <header className="workspace-header flex h-[4.75rem] items-center justify-between border-b border-[var(--border)] bg-white/85 px-5 backdrop-blur sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              className="grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-white lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              aria-controls="workspace-navigation"
              ref={menuTriggerRef}
            >
              <Menu className="size-5" />
            </button>
            <div>
              <p className="text-sm font-semibold">{view === "analytics" ? analyticsData?.title || "My analytics" : viewTitle(view, maintenanceWorkspace)}</p>
              <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
                Perfection at every stage.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(currentUser.role === "client" || currentUser.role === "stays" || isWorkspaceAdmin(currentUser.role)) && (
              <NotificationCentre
                initialData={onboardingData}
                role={currentUser.role}
                onOpenOnboarding={() => openOnboarding(currentUser.role === "client" ? "client" : "staff")}
              />
            )}
            <Badge className="border-0 bg-[var(--muted)] px-3 py-1 text-[var(--muted-foreground)]">
              {roleLabels[currentUser.role]}
            </Badge>
            <div className="grid size-9 place-items-center rounded-full bg-[#315f50] text-sm font-bold text-white">
              {initials(currentUser.name)}
            </div>
          </div>
        </header>

        <div key={view} className="workspace-view mx-auto max-w-[92rem] p-5 sm:p-8 lg:p-10">
          {view === "analytics" && <AnalyticsBoard initialData={analyticsData || scopeAnalytics(currentUser, {})} preview={preview} />}
          {view === "my-recharge" &&
            currentUser.role === "stays" &&
            myRecharge && <MyRecharge initialData={myRecharge} />}
          {operationsSections.map((section) =>
            view === section.id &&
            visibleOperationsSections.some((item) => item.id === section.id) ? (
                <OperationsSection
                  key={section.id}
                  section={section}
                  modules={section.modules.flatMap((moduleId) =>
                    visibleModules.filter((module) => module.id === moduleId),
                  )}
                  workflowData={workflowData}
                  onOpenCommunications={() => setView("communications")}
                  onOpenMaintenance={openMaintenance}
                  onOpenPropertyDatabase={() => setView("property-database")}
                  onOpenOnboarding={openOnboarding}
                  onOpenCleans={openCleans}
                  onOpenPurchaseOrders={openPurchaseOrders}
                  onOpenClientProperties={() => setView("client-properties")}
                  onOpenClientCalendar={() => setView("client-calendar")}
                  onOpenOperations={openOperations}
                  onOpenOwnerStatements={() => setView("owner-statements")}
                  onOpenWorkflowBoard={(mode) => { setWorkflowBoardMode(mode); setView("workflow-board"); }}
                />
            ) : null,
          )}
          {(view === "client-properties" || view === "client-calendar") && (
            <ClientWorkspace
              propertyData={propertyDatabaseData}
              onboardingCases={onboardingData?.cases || []}
              initialTool={view === "client-properties" ? "properties" : "calendar"}
              onBack={() => setView("clients")}
            />
          )}
          {view === "communications" &&
            communicationData &&
            currentUser.modules.includes("guest-communication") && (
              <CommunicationCentre
                currentUser={currentUser}
                data={communicationData}
                onBack={() => setView("stays")}
              />
            )}
          {view === "maintenance" && maintenanceData && (
            <MaintenanceCentre
              initialData={maintenanceData}
              initialWorkspace={maintenanceWorkspace}
              currentUser={currentUser}
              onBack={() =>
                setView(
                  maintenanceWorkspace === "ready"
                    ? "ready"
                    : maintenanceWorkspace === "accounts"
                      ? "accounts"
                      : maintenanceWorkspace === "client"
                        ? "clients"
                        : "stays",
                )
              }
            />
          )}
          {view === "property-database" && propertyDatabaseData && (
            <PropertyDatabase
              initialData={propertyDatabaseData}
              onBack={() => setView("stays")}
            />
          )}
          {view === "onboarding" && onboardingData && (
            <OnboardingCentre
              initialData={onboardingData}
              currentUser={currentUser}
              mode={onboardingMode}
              managedProperties={
                propertyDatabaseData?.properties.map(
                  (property) => property.propertyName,
                ) || []
              }
              onBack={() =>
                setView(onboardingMode === "client" ? "clients" : "stays")
              }
            />
          )}
          {view === "cleans-centre" && cleansData && (
            <CleansCentre
              initialData={cleansData}
              mode={cleansMode}
              role={currentUser.role}
              onBack={() =>
                setView(
                  cleansMode === "client-mailbox"
                    ? "clients"
                    : cleansMode === "replenishment-requests"
                      ? "accounts"
                      : cleansMode === "clean-reporting"
                        ? "stays"
                        : "cleans",
                )
              }
            />
          )}
          {view === "purchase-orders" && (
            <PurchaseOrderCentre
              currentUser={currentUser}
              initialWorkspace={purchaseOrderWorkspace}
              onBack={() =>
                setView(
                  purchaseOrderWorkspace === "client"
                    ? "clients"
                    : purchaseOrderWorkspace === "accounts"
                      ? "accounts"
                      : purchaseOrderWorkspace === "stays"
                        ? "stays"
                        : "ready",
                )
              }
            />
          )}
          {view === "operations-centre" && (
            <OperationsCentre
              initialMode={operationsMode}
              onBack={() => setView(operationsMode === "ready-calendar" || operationsMode === "routine-maintenance" ? "ready" : operationsMode === "direct-booking-accounts" ? "accounts" : "stays")}
              onOpenPropertyDatabase={() => setView("property-database")}
            />
          )}
          {view === "owner-statements" && (
            <OwnerStatementsCentre onBack={() => setView("accounts")} />
          )}
          {view === "onboarding-invoices-board" && <WorkflowToolBoard mode="onboarding-invoices" initialData={workflowData} onBack={() => setView("accounts")} />}
          {view === "new-property-inspections-board" && <WorkflowToolBoard mode="new-property-inspections" initialData={workflowData} onBack={() => setView("ready")} />}
          {view === "workflow-board" && <WorkflowToolBoard mode={workflowBoardMode} initialData={workflowData} onBack={() => setView(workflowBoardMode === "onboarding-invoices" ? "accounts" : workflowBoardMode === "aircover-reporting" ? "stays" : "ready")} />}
          {view === "team" && currentUser.role !== "client" && (
            <TeamClient
              users={accessUsers}
              isAdmin={isWorkspaceAdmin(currentUser.role)}
              currentUserName={currentUser.name}
              signOutPath={signOutPath}
              embedded
            />
          )}
          {view === "access" && isWorkspaceAdmin(currentUser.role) && (
            <Access accessUsers={accessUsers} />
          )}
        </div>
      </main>
    </div>
    </ActorRoleContext.Provider></PreviewContext.Provider>
  );
}

function Overview({
  currentUser,
  visibleModules,
  onViewTools,
}: {
  currentUser: CurrentUser;
  visibleModules: readonly Module[];
  onViewTools: () => void;
}) {
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const firstName = currentUser.name.includes("@")
    ? "there"
    : currentUser.name.split(" ")[0];

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
        <div>
          <p className="eyebrow">{today}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Good {dayPart()}, {firstName}.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
            One standard, one workspace, every stage connected.
          </p>
        </div>
        <Button
          className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]"
          onClick={onViewTools}
        >
          Open your tools <ArrowUpRight />
        </Button>
      </section>

      <section className="overflow-hidden rounded-[1.65rem] bg-[#1c3934] text-white shadow-[0_20px_60px_rgba(24,58,46,0.14)]">
        <div className="grid gap-7 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#315f50] text-white">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-lg font-semibold">The Recharge standard</p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-white/60">
                Pricing, presentation, furnishing, safety and purchasing now
                share one route through the business.
              </p>
            </div>
          </div>
          <div className="w-full min-w-64 lg:w-72">
            <div className="mb-2 flex justify-between text-xs font-medium text-white/55">
              <span>Foundation</span>
              <span>Stage 1 of 3</span>
            </div>
            <Progress
              value={33}
              className="h-1.5 bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#315f50]"
            />
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-5">
          {["Price", "List", "Furnish", "Inspect", "Purchase"].map(
            (stage, index) => (
              <div
                className="flex items-center gap-3 border-b border-white/10 px-5 py-4 last:border-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
                key={stage}
              >
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                  0{index + 1}
                </span>
                <span className="text-sm font-medium text-white/75">
                  {stage}
                </span>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Tools available"
          value={String(visibleModules.length)}
          note={"of " + MODULES.length + " current tools"}
          icon={ListChecks}
        />
        <Stat
          label="Access level"
          value={roleLabels[currentUser.role]}
          note="Assigned by overall admin"
          icon={ShieldCheck}
        />
        <Stat
          label="Workspace"
          value="Live"
          note="Recharge foundation"
          icon={Check}
          accent
        />
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              Business tools
            </h2>
          </div>
          <button
            className="text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            onClick={onViewTools}
          >
            View all <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleModules.slice(0, 4).map((module) => (
            <ToolCard key={module.id} module={module} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Tools({
  modules,
  onOpenCommunications,
  onOpenMaintenance,
  onOpenPropertyDatabase,
  onOpenOnboarding,
}: {
  modules: readonly Module[];
  onOpenCommunications: () => void;
  onOpenMaintenance: (workspace: MaintenanceWorkspace) => void;
  onOpenPropertyDatabase: () => void;
  onOpenOnboarding: () => void;
}) {
  return (
    <div>
      <p className="eyebrow">Recharge system</p>
      <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Every tool. One standard.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
            Only the tools assigned to your role appear here.
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-fit border-[var(--border)] bg-white px-3 py-1.5 text-[var(--muted-foreground)]"
        >
          {modules.length} available
        </Badge>
      </div>
      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        {modules.map((module) => (
          <ToolCard
            key={module.id}
            module={module}
            large
            onOpen={
              module.id === "guest-communication"
                ? onOpenCommunications
                : module.id === "property-onboarding" ||
                    module.id === "client-dashboard"
                  ? onOpenOnboarding
                : module.id === "property-database"
                  ? onOpenPropertyDatabase
                : maintenanceWorkspaceForModule(module.id)
                  ? () =>
                      onOpenMaintenance(
                        maintenanceWorkspaceForModule(module.id)!,
                      )
                  : undefined
            }
          />
        ))}
      </div>
      {modules.length === 0 && (
        <div className="mt-8 rounded-3xl border border-dashed border-[var(--border)] bg-white p-10 text-center text-[var(--muted-foreground)]">
          No tools have been assigned to this account.
        </div>
      )}
    </div>
  );
}

function MyRecharge({ initialData }: { initialData: MyRechargeData }) {
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function changeClock() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/my-recharge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: data.openEntry ? "clock_out" : "clock_in",
      }),
    });
    const result = (await response.json().catch(() => null)) as
      | MyRechargeData
      | { error?: string }
      | null;
    if (!response.ok || !result || !("performance" in result)) {
      setError(
        (result && "error" in result && result.error) ||
          "Your time could not be updated. Please try again.",
      );
      setSaving(false);
      return;
    }
    setData(result);
    setSaving(false);
  }

  if (!data.available) {
    return (
      <section className="rounded-[1.5rem] border border-[var(--border)] bg-white p-8">
        <p className="eyebrow">Personal workspace</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
          My Recharge
        </h1>
        <p className="mt-4 text-base text-[var(--muted-foreground)]">
          My Recharge is temporarily unavailable. Please try again shortly.
        </p>
      </section>
    );
  }

  return (
    <div>
      <p className="eyebrow">Personal workspace</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
        My Recharge
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
        Clock in, check your schedule and review your performance.
      </p>

      <Tabs defaultValue="clock" className="mt-8">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--muted)] p-1 sm:w-fit">
          <TabsTrigger value="clock" className="min-h-10 px-4">
            Clock in
          </TabsTrigger>
          <TabsTrigger value="schedule" className="min-h-10 px-4">
            Schedule
          </TabsTrigger>
          <TabsTrigger value="performance" className="min-h-10 px-4">
            Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clock" className="mt-6">
          <section className="overflow-hidden rounded-[1.65rem] bg-[#1c3934] text-white shadow-[0_20px_60px_rgba(24,58,46,0.14)]">
            <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white/65">
                  <span
                    className={
                      "size-2 rounded-full " +
                      (data.openEntry ? "bg-[#315f50]" : "bg-white/30")
                    }
                  />
                  {data.openEntry ? "Currently clocked in" : "Ready to start"}
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                  {data.openEntry
                    ? `Started ${formatDateTime(data.openEntry.clockIn)}`
                    : "You are not clocked in"}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  Your time is saved securely to your Recharge profile.
                </p>
              </div>
              <Button
                className={
                  "h-12 min-w-36 rounded-xl px-6 font-semibold " +
                  (data.openEntry
                    ? "bg-white text-[var(--foreground)] hover:bg-white/90"
                    : "bg-[#315f50] text-white hover:bg-[#274e42]")
                }
                disabled={saving}
                onClick={changeClock}
              >
                <Play className="size-4" />
                {saving
                  ? "Saving…"
                  : data.openEntry
                    ? "Clock out"
                    : "Clock in"}
              </Button>
            </div>
          </section>
          {error && (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <section className="mt-5 rounded-[1.5rem] border border-[var(--border)] bg-white p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Recent time</h2>
            {data.recentEntries.length ? (
              <div className="mt-4 divide-y divide-[var(--border)]">
                {data.recentEntries.map((entry) => (
                  <div
                    className="flex flex-col justify-between gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                    key={entry.id}
                  >
                    <span className="text-sm font-medium">
                      {formatDateTime(entry.clockIn)}
                    </span>
                    <span className="text-sm text-[var(--muted-foreground)]">
                      {entry.clockOut
                        ? `${formatTime(entry.clockIn)}–${formatTime(entry.clockOut)}`
                        : "In progress"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Your first clock-in will appear here.
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="schedule" className="mt-6">
          <section className="rounded-[1.5rem] border border-[var(--border)] bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Next seven days</p>
                <h2 className="mt-2 text-2xl font-semibold">Your schedule</h2>
              </div>
              <Badge className="border-0 bg-[var(--muted)] text-[var(--muted-foreground)]">
                {data.schedule.length} shifts
              </Badge>
            </div>
            {data.schedule.length ? (
              <div className="mt-5 space-y-3">
                {data.schedule.map((shift) => (
                  <div
                    className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-4 sm:flex-row sm:items-center"
                    key={shift.id}
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {formatShiftDate(shift.shiftDate)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{shift.label}</p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--muted-foreground)]">
                      {shift.startTime}–{shift.endTime}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-xl bg-[var(--muted)] px-5 py-8 text-center">
                <p className="text-sm font-medium">No shifts assigned</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Your next scheduled shift will appear here.
                </p>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="performance" className="mt-6">
          <section className="grid gap-4 sm:grid-cols-3">
            <PerformanceStat
              label="Hours this week"
              value={data.performance.hoursThisWeek.toFixed(1)}
            />
            <PerformanceStat
              label="Days clocked"
              value={String(data.performance.daysClocked)}
            />
            <PerformanceStat
              label="Completed shifts"
              value={String(data.performance.completedShifts)}
            />
          </section>
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            Performance updates automatically from your recorded time.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PerformanceStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[1.4rem] border border-[var(--border)] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-7 text-4xl font-semibold tracking-[-0.05em]">{value}</p>
    </article>
  );
}

function OperationsSection({
  section,
  modules,
  workflowData,
  onOpenCommunications,
  onOpenMaintenance,
  onOpenPropertyDatabase,
  onOpenOnboarding,
  onOpenCleans,
  onOpenPurchaseOrders,
  onOpenClientProperties,
  onOpenClientCalendar,
  onOpenOperations,
  onOpenOwnerStatements,
  onOpenWorkflowBoard,
}: {
  section: (typeof operationsSections)[number];
  modules: readonly Module[];
  workflowData?: WorkflowData;
  onOpenCommunications: () => void;
  onOpenMaintenance: (workspace: MaintenanceWorkspace) => void;
  onOpenPropertyDatabase: () => void;
  onOpenOnboarding: (mode: "client" | "staff") => void;
  onOpenCleans: (mode: CleansMode) => void;
  onOpenPurchaseOrders: (workspace: PurchaseOrderWorkspace) => void;
  onOpenClientProperties: () => void;
  onOpenClientCalendar: () => void;
  onOpenOperations: (mode: OperationsMode) => void;
  onOpenOwnerStatements: () => void;
  onOpenWorkflowBoard: (mode: WorkflowToolMode) => void;
}) {
  const Icon = section.icon;
  const [toolSearch, setToolSearch] = useState("");
  const filteredModules = modules.filter((module) =>
    module.name
      .toLowerCase()
      .includes(toolSearch.trim().toLowerCase()),
  );

  return (
    <div>
      <div className="department-heading flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="department-heading-content">
          <DepartmentIllustration department={section.id} />
          <div>
          <p className="eyebrow">Recharge department</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-[2.75rem]">
            {section.label}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
            {section.description}
          </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="h-fit border-[var(--border)] bg-white px-3 py-1.5 text-[var(--muted-foreground)]"
        >
          {modules.length} {modules.length === 1 ? "tool" : "tools"}
        </Badge>
      </div>

      <div className="tool-search relative mt-7 max-w-2xl">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          className="h-12 rounded-2xl border-[var(--border)] bg-white pl-11 pr-12"
          value={toolSearch}
          onChange={(event) => setToolSearch(event.target.value)}
          placeholder={`Search ${section.label} tools`}
          aria-label={`Search ${section.label} tools`}
        />
        {toolSearch && <button className="absolute right-1 top-1 grid size-10 place-items-center rounded-xl text-[var(--muted-foreground)] hover:bg-[var(--muted)]" aria-label="Clear tool search" onClick={() => setToolSearch("")}><X className="size-4" /></button>}
      </div>
      {toolSearch && <p className="mt-3 text-xs text-[var(--muted-foreground)]" role="status">{filteredModules.length} of {modules.length} tools match your search</p>}

      {section.id !== "cleans" && (
        <WorkflowPanels section={section.id} data={workflowData} />
      )}

      {filteredModules.length > 0 ? (
        <div className="tool-grid mt-8 grid gap-5 xl:grid-cols-2">
          {filteredModules.map((module) => (
            <ToolCard
              key={module.id}
              module={clientModulePresentation(module, section.id)}
              large
              onOpen={
                section.id === "clients" && module.id === "client-dashboard"
                  ? onOpenClientProperties
                  : section.id === "clients" && module.id === "property-onboarding"
                    ? onOpenClientCalendar
                : purchaseOrderWorkspaceForModule(module.id, section.id)
                  ? () =>
                      onOpenPurchaseOrders(
                        purchaseOrderWorkspaceForModule(module.id, section.id)!,
                      )
                  : isCleansCentreModule(module.id)
                  ? () => onOpenCleans(module.id as CleansMode)
                  : module.id === "guest-communication"
                  ? onOpenCommunications
                  : module.id === "property-onboarding" ||
                      module.id === "client-dashboard"
                    ? () =>
                        onOpenOnboarding(
                          section.id === "clients" ? "client" : "staff",
                        )
                  : module.id === "property-database"
                    ? onOpenPropertyDatabase
                  : module.id === "ready-schedule"
                    ? () => onOpenOperations("ready-calendar")
                  : module.id === "safety-maintenance"
                    ? () => onOpenOperations("routine-maintenance")
                  : module.id === "new-property-inspection-board"
                    ? () => onOpenWorkflowBoard("new-property-inspections")
                  : module.id === "onboarding-invoices"
                    ? () => onOpenWorkflowBoard("onboarding-invoices")
                  : module.id === "property-furnishing-board"
                    ? () => onOpenWorkflowBoard("property-furnishing")
                  : module.id === "routine-bin-garden-board"
                    ? () => onOpenWorkflowBoard("routine-bin-garden")
                  : module.id === "aircover-reporting"
                    ? () => onOpenWorkflowBoard("aircover-reporting")
                  : module.id === "owner-statements"
                    ? onOpenOwnerStatements
                  : module.id === "listing-health"
                    ? () => onOpenOperations("listing-health")
                  : module.id === "daily-pricing"
                    ? () => onOpenOperations("daily-pricing")
                  : module.id === "weekly-performance"
                    ? () => onOpenOperations("weekly-performance")
                  : module.id === "direct-bookings"
                    ? () => onOpenOperations(section.id === "accounts" ? "direct-booking-accounts" : "direct-bookings")
                  : maintenanceWorkspaceForModule(module.id)
                    ? () =>
                        onOpenMaintenance(
                          maintenanceWorkspaceForModule(module.id)!,
                        )
                    : undefined
              }
            />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <section className="mt-8 rounded-[1.5rem] border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center sm:px-10">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--muted)] text-[var(--muted-foreground)]">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">No tools connected yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
            This section is ready for the {section.label.toLowerCase()} tools we
            add next.
          </p>
        </section>
      ) : (
        <section className="mt-8 rounded-[1.5rem] border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center sm:px-10">
          <Search className="mx-auto size-6 text-[var(--muted-foreground)]" />
          <h2 className="mt-4 text-xl font-semibold">No matching tools</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Try a different name or keyword.</p>
          <Button className="mt-5" variant="outline" onClick={() => setToolSearch("")}>Clear search</Button>
        </section>
      )}
    </div>
  );
}

function ToolCard({
  module,
  large = false,
  onOpen,
}: {
  module: ModuleCard;
  large?: boolean;
  onOpen?: () => void;
}) {
  const preview = useContext(PreviewContext);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const action = onOpen ? "Open centre" : module.url && !preview ? "Open tool" : "View details";
  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
    <article className={"tool-card group " + (large ? "tool-card-large" : "")}>
      <div className="flex items-start justify-between gap-4">
        <span className="tool-art-stage"><ToolIllustration id={module.id} fallback={icons[module.id]} /></span>
        <Badge className="tool-audience border-0 bg-[var(--muted)] text-[0.6rem] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
          {module.audience}
        </Badge>
      </div>
      <div className="tool-card-copy">
        <h3 className="text-[1.35rem] leading-7 font-semibold tracking-[-0.025em]">
          {module.name}
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
          {module.description}
        </p>
      </div>
      <div className="tool-card-footer flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <span className="tool-category text-xs font-medium text-[var(--muted-foreground)]">
          {module.category}
        </span>
        <span className="tool-card-action" aria-hidden="true">{action}<span className="tool-card-arrow"><ChevronRight className="size-4" /></span></span>
      </div>
      {module.url && !preview && !onOpen ? <a className="tool-card-hitarea" href={"/tool/" + module.id} target="_blank" rel="noreferrer" aria-label={`Open ${module.name} in a new tab`} /> : onOpen ? <button className="tool-card-hitarea" onClick={onOpen} aria-label={`Open ${module.name}`} /> : <DialogTrigger asChild><button className="tool-card-hitarea" aria-label={`View details for ${module.name}`} /></DialogTrigger>}
    </article>
      <DialogContent>
        <ToolIllustration id={module.id} className="tool-modal-art" />
        <DialogHeader><DialogTitle className="text-2xl leading-8">{module.name}</DialogTitle><DialogDescription className="leading-6">{module.description}</DialogDescription></DialogHeader>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm leading-6 text-[var(--muted-foreground)]">
          {module.url && preview ? "This external tool is not connected in this read-only preview. It will open from the authenticated application when its integration is ready." : liveInternalModules.has(module.id) ? "This workflow is available in the department work boards. Use those boards to review and manage its tickets." : "This tool is planned. Its dedicated workflow will become available once the integration is complete."}
        </div>
        <DialogFooter><Button onClick={() => setDetailsOpen(false)}>Back to tools</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Access({ accessUsers }: { accessUsers: AccessUser[] }) {
  const actorRole = useContext(ActorRoleContext);
  const pending = accessUsers.filter((user) => user.status === "pending").length;
  const active = accessUsers.filter((user) => user.status === "active").length;

  return (
    <div>
      <p className="eyebrow">Administration</p>
      <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Accounts & access
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">
            Approve account requests, assign roles and control every user’s tool access.
          </p>
        </div>
        <AccessDialog />
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        <span className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--muted-foreground)]">
          {active} active
        </span>
        <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${pending ? "border-amber-200 bg-amber-50 text-amber-800" : "border-[var(--border)] bg-white text-[var(--muted-foreground)]"}`}>
          {pending} pending approval
        </span>
      </div>

      <section className="mt-8 overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-white">
        <div className="hidden grid-cols-[1.2fr_0.75fr_0.65fr_1.45fr_auto] gap-5 border-b border-[var(--border)] bg-[var(--card)] px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)] lg:grid">
          <span>User</span>
          <span>Account type</span>
          <span>Status</span>
          <span>Tool access</span>
          <span />
        </div>
        {accessUsers.map((user) => (
          <div
            className={`grid gap-4 border-b border-[var(--border)] px-5 py-5 last:border-0 lg:grid-cols-[1.2fr_0.75fr_0.65fr_1.45fr_auto] lg:items-center lg:px-6 ${user.status === "pending" ? "bg-amber-50/45" : ""}`}
            key={user.email}
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-[var(--muted)] text-sm font-bold text-[var(--rc-info-text)]">
                {initials(user.fullName || user.email)}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {user.fullName || "Unnamed user"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{user.email}</p>
              </div>
            </div>
            <div>
              <Badge
                variant="outline"
                className="border-[var(--border)] bg-[var(--card)] text-[var(--rc-info-text)]"
              >
                {roleLabels[user.role]}
              </Badge>
            </div>
            <div>
              <StatusBadge status={user.status} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.modules.slice(0, 5).map((moduleId) => (
                <span
                  className="rounded-md bg-[var(--muted)] px-2 py-1 text-[0.68rem] font-medium text-[var(--muted-foreground)]"
                  key={moduleId}
                >
                  {MODULES.find((module) => module.id === moduleId)?.shortName}
                </span>
              ))}
              {user.modules.length > 5 && (
                <span className="rounded-md bg-[var(--muted)] px-2 py-1 text-[0.68rem] font-semibold text-[var(--muted-foreground)]">
                  +{user.modules.length - 5} more
                </span>
              )}
              {user.modules.length === 0 && (
                <span className="text-xs text-[var(--muted-foreground)]">No tools selected</span>
              )}
            </div>
            <div>
              {actorRole !== "super_admin" && (user.role === "super_admin" || isWorkspaceAdmin(user.role)) ? (
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Super-admin managed</span>
              ) : (
                <AccessDialog user={user} />
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AccessDialog({ user, teamOnly = false }: { user?: AccessUser; teamOnly?: boolean }) {
  const preview = useContext(PreviewContext);
  const actorRole = useContext(ActorRoleContext);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(user?.role || "stays");
  const [status, setStatus] = useState<AccessStatus>(user?.status || "active");
  const [selected, setSelected] = useState<ModuleId[]>(
    user?.modules || defaultModulesForRole(user?.role || "stays"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function changeRole(next: Role) {
    setRole(next);
    setSelected(defaultModulesForRole(next));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("fullName"),
        email: user?.email || form.get("email"),
        role,
        status,
        modules: selected,
        responsibilities: form.get("responsibilities"),
      }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(result?.error || "Access could not be saved. Check the details and try again.");
      setSaving(false);
      return;
    }
    setOpen(false);
    window.location.reload();
    } catch { setError("Could not save access. Check your connection and try again."); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {user ? (
          <Button variant="outline" className="rounded-xl border-[var(--border)] bg-white">
            Manage
          </Button>
        ) : (
          <Button className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]">
            <Plus /> {teamOnly ? "Add team member" : "Add account"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[var(--border)] p-0 sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[var(--border)] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">
              {user ? "Manage account" : teamOnly ? "Add a team member" : "Add an account"}
            </DialogTitle>
            <DialogDescription>
              {user
                ? "Change this person’s role, status and individual tool access."
                : teamOnly ? "Add the person, choose their department and record what they are responsible for." : "Assign access to an existing verified sign-in account using their email."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 px-6 py-6">
            {preview && <p className="rounded-xl bg-[var(--muted)] p-3 text-sm text-[var(--muted-foreground)]">Preview only. Account changes will be available in the authenticated workspace.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Name</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  required
                  defaultValue={user?.fullName || ""}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  required
                  type="email"
                  defaultValue={user?.email || ""}
                  disabled={Boolean(user)}
                  placeholder="name@company.com"
                />
              </div>
            </div>
            <div className="space-y-2">
                <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(value) => changeRole(value as Role)}
              >
                <SelectTrigger className="h-11 w-full" aria-label="Account role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!teamOnly && <SelectItem value="client">Client</SelectItem>}
                  <SelectItem value="stays">Stays employee</SelectItem>
                  <SelectItem value="cleans">Cleaner</SelectItem>
                  <SelectItem value="cleaning_manager">Cleaning manager</SelectItem>
                  <SelectItem value="ready">Ready employee</SelectItem>
                  {actorRole === "super_admin" && <><SelectItem value="admin">Admin</SelectItem><SelectItem value="super_admin">Super admin</SelectItem></>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="responsibilities">Responsibilities</Label>
              <Textarea
                id="responsibilities"
                name="responsibilities"
                rows={4}
                defaultValue={user?.responsibilities || ""}
                placeholder="Describe the areas, decisions and recurring work this person owns."
              />
            </div>
            {user && (
              <div className="space-y-2">
                <Label>Account status</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as AccessStatus)}
                >
                  <SelectTrigger className="h-11 w-full" aria-label="Account status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending approval</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
                {user.status === "pending" && status !== "active" && (
                  <p className="text-xs leading-5 text-amber-800">
                    Change the status to Active to approve this request.
                  </p>
                )}
              </div>
            )}
            <div>
              <div className="flex items-center justify-between gap-4">
                <Label>Tool access</Label>
                {!isWorkspaceAdmin(role) && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    onClick={() => setSelected(defaultModulesForRole(role))}
                  >
                    Reset to role defaults
                  </button>
                )}
              </div>
              {role === "super_admin" && <p className="mt-3 rounded-xl bg-[var(--muted)] p-3 text-sm">Full access to every department, analytics and administration. Can manage admin accounts and individual permissions.</p>}
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {MODULES.map((module) => {
                  const checked = selected.includes(module.id);
                  return (
                    <label
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3.5 hover:bg-[var(--muted)]"
                      key={module.id}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={isWorkspaceAdmin(role)}
                        onCheckedChange={(value) =>
                          setSelected((items) =>
                            value === true
                              ? [...items, module.id]
                              : items.filter((id) => id !== module.id),
                          )
                        }
                      />
                      <span>
                        <span className="block text-sm font-semibold">
                          {module.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                          {module.audience}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="border-t border-[var(--border)] px-6 py-5">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                preview || saving ||
                (status === "active" && !isWorkspaceAdmin(role) && selected.length === 0)
              }
              className="rounded-xl bg-[#1c3934] text-white hover:bg-[#10271f]"
            >
              {saving
                ? "Saving…"
                : user?.status === "pending" && status === "active"
                  ? "Approve & save"
                  : "Save access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: AccessStatus }) {
  const styles = {
    active: "border-emerald-200 bg-emerald-50 text-emerald-800",
    pending: "border-amber-200 bg-amber-50 text-amber-800",
    revoked: "border-slate-200 bg-slate-50 text-slate-600",
  }[status];
  const label = {
    active: "Active",
    pending: "Pending",
    revoked: "Revoked",
  }[status];

  return (
    <Badge variant="outline" className={styles}>
      {label}
    </Badge>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Users;
  accent?: boolean;
}) {
  return (
    <article
      className={
        "rounded-[1.4rem] border p-5 " +
        (accent
          ? "border-[var(--border)] bg-[var(--muted)]"
          : "border-[var(--border)] bg-white")
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--muted-foreground)]">
          {label}
        </p>
        <Icon className="size-4 text-[var(--muted-foreground)]" />
      </div>
      <p className="mt-8 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">{note}</p>
    </article>
  );
}

function NavButton({
  active,
  icon: Icon,
  index,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Home;
  index: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={"nav-button " + (active ? "nav-button-active" : "")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="text-[0.65rem] font-semibold tracking-[0.08em] text-white/35">
        {index}
      </span>
      <Icon className="size-[1.05rem]" />
      <span>{label}</span>
    </button>
  );
}

function initials(value: string) {
  const clean = value.includes("@") ? value.split("@")[0] : value;
  return (
    clean
      .split(/[ ._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "R"
  );
}

function viewTitle(view: View, maintenanceWorkspace: MaintenanceWorkspace) {
  if (view === "analytics") return "Workspace analytics";
  if (view === "workflow-board") return "Workflow centre";
  if (view === "overview") return "Overview";
  if (view === "tools") return "Business tools";
  if (view === "my-recharge") return "My Recharge";
  if (view === "communications") return "Stays Communication Centre";
  if (view === "maintenance") {
    if (maintenanceWorkspace === "ready") return "Ready Maintenance";
    if (maintenanceWorkspace === "accounts") return "Approved Maintenance";
    if (maintenanceWorkspace === "client") return "Property Maintenance";
    return "Maintenance Reporting";
  }
  if (view === "property-database") return "Management Property Database";
  if (view === "onboarding") return "Property Onboarding";
  if (view === "onboarding-invoices-board") return "Property Onboarding Invoices";
  if (view === "new-property-inspections-board") return "New Property Inspections";
  if (view === "client-properties") return "My Properties";
  if (view === "client-calendar") return "My Calendar";
  if (view === "cleans-centre") return "Connected Cleans workflow";
  if (view === "purchase-orders") return "Recharge Purchase Orders";
  if (view === "operations-centre") return "Connected Operations";
  if (view === "team") return "Team";
  if (view === "access") return "Users & access";
  return operationsSections.find((section) => section.id === view)?.label || "Recharge";
}

function defaultDepartment(role: WorkspaceRole): OperationsView {
  if (role === "client") return "clients";
  if (role === "cleans") return "cleans";
  if (role === "ready") return "ready";
  return "stays";
}

function clientModulePresentation(module: Module, sectionId: string): ModuleCard {
  if (sectionId !== "clients") return module;
  if (module.id === "client-dashboard") return { ...module, name: "My Properties", shortName: "My properties", description: "View each managed property, onboarding progress, actions and weekly performance." };
  if (module.id === "property-onboarding") return { ...module, name: "My Calendar", shortName: "My calendar", description: "See Hostaway bookings across your properties and choose which calendars to display." };
  return module;
}

function isCleansCentreModule(moduleId: ModuleId): moduleId is CleansMode {
  return [
    "clean-client-database",
    "cleaner-database",
    "cleaning-schedule",
    "cleaner-performance",
    "clean-property-onboarding",
    "cleans-invoices",
    "clean-reporting",
    "client-mailbox",
    "replenishment-requests",
  ].includes(moduleId);
}

function maintenanceWorkspaceForModule(
  moduleId: ModuleId,
): MaintenanceWorkspace | undefined {
  if (moduleId === "stays-maintenance-reporting") return "stays";
  if (moduleId === "maintenance-reporting") return "ready";
  if (moduleId === "maintenance-reconciliation") return "accounts";
  if (moduleId === "client-property-maintenance") return "client";
  return undefined;
}

function purchaseOrderWorkspaceForModule(
  moduleId: ModuleId,
  sectionId: string,
): PurchaseOrderWorkspace | undefined {
  if (moduleId === "purchase-order-requests") return "stays";
  if (moduleId === "client-purchase-order-quotes") return "client";
  if (moduleId === "purchase-order-invoices" || moduleId === "purchase-order-accounts") {
    return "accounts";
  }
  if (moduleId === "purchase-order") {
    return sectionId === "stays" ? "stays" : "ready";
  }
  return undefined;
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatShiftDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00Z`));
}

function dayPart() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
