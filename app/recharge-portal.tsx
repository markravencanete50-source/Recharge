"use client";

import { FormEvent, useEffect, useMemo, useState, type MouseEvent } from "react";
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
  LogOut,
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
import { WorkflowToolBoard } from "@/app/workflow-tool-board";
import { TeamClient } from "@/app/team/team-client";
import { OwnerStatementsCentre } from "@/app/owner-statements-centre";

type Role = WorkspaceRole;
type OperationsView =
  | "cleans"
  | "ready"
  | "stays"
  | "clients"
  | "accounts"
  | "marketing";
type View =
  | "overview"
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
  admin: "Admin",
  stays: "Stays employee",
  cleans: "Cleans employee",
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
}) {
  const [view, setView] = useState<View>(defaultDepartment(currentUser.role));
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
  const [scrolled, setScrolled] = useState(false);
  const visibleModules = useMemo(
    () => MODULES.filter((module) => currentUser.modules.includes(module.id)),
    [currentUser.modules],
  );
  const visibleOperationsSections = useMemo(
    () =>
      operationsSections.filter((section) =>
        section.modules.some((moduleId) => currentUser.modules.includes(moduleId)),
      ),
    [currentUser.modules, currentUser.role],
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const currentDepartment = departmentForView(view, {
    maintenanceWorkspace,
    cleansMode,
    purchaseOrderWorkspace,
    operationsMode,
    onboardingMode,
  });
  const firstName = currentUser.name.includes("@")
    ? ""
    : currentUser.name.split(" ")[0];

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
    <div className="min-h-dvh bg-[#f0f4f1] text-[#1c3934]">
      <GuestMessageNotifier
        enabled={currentUser.modules.includes("guest-communication") && currentUser.role !== "client"}
        paused={view === "communications"}
        initialData={communicationData}
        onOpen={() => changeView("communications")}
      />
      <div
        className={"sidebar-backdrop lg:hidden " + (menuOpen ? "sidebar-backdrop-open" : "")}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={"sidebar " + (menuOpen ? "sidebar-open" : "")}
        aria-label="Workspace navigation"
      >
        <div className="flex items-center justify-between px-6 pb-4 pt-7">
          <button
            className="press group flex items-center gap-3 text-left"
            onClick={() =>
              changeView(defaultDepartment(currentUser.role))
            }
          >
            <span>
              <img
                src="/recharge-wordmark.svg"
                alt="Recharge"
                className="h-auto w-[9.4rem] transition-opacity duration-300 group-hover:opacity-85"
              />
              <span className="mt-2.5 flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-white/40">
                <span className="live-dot" aria-hidden="true" />
                Workspace
              </span>
            </span>
          </button>
          <button
            className="press grid size-9 place-items-center rounded-xl border border-white/10 text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mx-6 h-px bg-gradient-to-r from-white/0 via-white/15 to-white/0" />

        <nav
          key={menuOpen ? "open" : "closed"}
          className="scrollbar-thin mt-5 flex-1 overflow-y-auto px-4 pb-6"
          aria-label="Workspace"
        >
          {currentUser.role === "stays" && (
          <div className="mb-7 space-y-1">
            <NavHeading>Personal</NavHeading>
              <NavButton
                active={view === "my-recharge"}
                icon={UserRoundCheck}
                index="01"
                label="My Recharge"
                order={1}
                onClick={() => changeView("my-recharge")}
              />
          </div>
          )}

          <div className="space-y-1">
            <NavHeading>Departments</NavHeading>
            {visibleOperationsSections.map((section, index) => (
              <NavButton
                active={view === section.id}
                inside={view !== section.id && currentDepartment === section.id}
                icon={section.icon}
                index={String(index + 1 + (currentUser.role === "stays" ? 1 : 0)).padStart(2, "0")}
                key={section.id}
                label={section.label}
                order={index + 2}
                onClick={() => changeView(section.id)}
              />
            ))}
          </div>

          {currentUser.role !== "client" && (
            <div className="mt-7 space-y-1">
              <NavHeading>Company</NavHeading>
              <NavButton
                active={view === "team"}
                icon={Users}
                index="09"
                label="Team"
                order={8}
                onClick={() => changeView("team")}
              />
            </div>
          )}

          {currentUser.role === "admin" && (
            <div className="mt-7 space-y-1">
              <NavHeading>Administration</NavHeading>
              <NavButton
                active={view === "access"}
                icon={UserRoundCog}
                index="10"
                label="Access"
                order={10}
                onClick={() => changeView("access")}
              />
            </div>
          )}
        </nav>

        <div className="p-4">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#8fb3a2] to-[#315f50] text-sm font-bold text-white shadow-inner">
              {initials(currentUser.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {currentUser.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-white/45">
                {roleLabels[currentUser.role]}
              </p>
            </div>
            <a
              className="press grid size-9 shrink-0 place-items-center rounded-xl text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              href={signOutPath}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </a>
          </div>
        </div>
      </aside>

      <main className="pb-28 lg:pb-0 lg:pl-[17rem]">
        <header
          className="app-header flex h-16 items-center justify-between px-4 sm:h-[4.5rem] sm:px-8 lg:px-10"
          data-scrolled={scrolled}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="press grid size-10 shrink-0 place-items-center rounded-xl border border-[#d9e2df] bg-white shadow-[var(--shadow-soft)] lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
            >
              <Menu className="size-[1.1rem]" />
            </button>
            <div className="min-w-0">
              <p className="hidden items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[#83958f] sm:flex">
                Workspace
                {currentDepartment && currentDepartment !== view && (
                  <>
                    <ChevronRight className="size-3" />
                    <button
                      className="uppercase transition-colors hover:text-[#1c3934]"
                      onClick={() => changeView(currentDepartment)}
                    >
                      {operationsSections.find((item) => item.id === currentDepartment)?.label}
                    </button>
                  </>
                )}
              </p>
              <p
                key={view + maintenanceWorkspace}
                className="animate-rise truncate text-[0.95rem] font-semibold tracking-[-0.01em] sm:mt-0.5"
              >
                {viewTitle(view, maintenanceWorkspace)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {(currentUser.role === "client" || currentUser.role === "stays" || currentUser.role === "admin") && (
              <NotificationCentre
                initialData={onboardingData}
                role={currentUser.role}
                onOpenOnboarding={() => openOnboarding(currentUser.role === "client" ? "client" : "staff")}
              />
            )}
            <Badge className="hidden border border-[#cfe0d8] bg-[#e4eee9] px-3 py-1 text-[#264d42] sm:inline-flex">
              {roleLabels[currentUser.role]}
            </Badge>
            <div
              className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[#315f50] to-[#1c3934] text-sm font-bold text-white shadow-[0_6px_16px_-8px_rgba(16,39,31,0.6)]"
              title={currentUser.name}
            >
              {initials(currentUser.name)}
            </div>
          </div>
        </header>

        <div
          key={view}
          className="view-enter mx-auto max-w-[92rem] px-4 pb-8 pt-5 sm:p-8 lg:p-10"
        >
          {view === "my-recharge" &&
            currentUser.role === "stays" &&
            myRecharge && <MyRecharge initialData={myRecharge} />}
          {operationsSections.map((section) =>
            view === section.id &&
            visibleOperationsSections.some((item) => item.id === section.id) ? (
                <OperationsSection
                  key={section.id}
                  section={section}
                  firstName={firstName}
                  index={visibleOperationsSections.findIndex((item) => item.id === section.id)}
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
                  onOpenWorkflowBoard={(mode) => setView(mode === "onboarding-invoices" ? "onboarding-invoices-board" : "new-property-inspections-board")}
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
          {view === "team" && currentUser.role !== "client" && (
            <TeamClient
              users={accessUsers}
              isAdmin={currentUser.role === "admin"}
              currentUserName={currentUser.name}
              signOutPath={signOutPath}
              embedded
            />
          )}
          {view === "access" && currentUser.role === "admin" && (
            <Access accessUsers={accessUsers} />
          )}
        </div>
      </main>

      {visibleOperationsSections.length > 1 && (
        <MobileDock
          sections={visibleOperationsSections}
          active={currentDepartment}
          onSelect={(id) => changeView(id)}
        />
      )}
    </div>
  );
}

function MobileDock({
  sections,
  active,
  onSelect,
}: {
  sections: readonly (typeof operationsSections)[number][];
  active: OperationsView | null;
  onSelect: (id: OperationsView) => void;
}) {
  const activeIndex = sections.findIndex((section) => section.id === active);
  return (
    <nav className="mobile-dock lg:hidden" aria-label="Departments">
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          className="mobile-dock-indicator"
          style={{
            width: `calc(${100 / sections.length}% - 0px)`,
            transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
            opacity: activeIndex < 0 ? 0 : 1,
            top: 0,
            bottom: 0,
            left: 0,
          }}
        />
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              className={
                "press relative flex flex-col items-center gap-1 rounded-[1.05rem] px-1 py-2 text-[0.64rem] font-semibold tracking-[0.02em] transition-colors duration-300 " +
                (isActive ? "text-white" : "text-white/50")
              }
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(section.id)}
            >
              <Icon
                className={
                  "size-[1.15rem] transition-all duration-500 " +
                  (isActive ? "-translate-y-px text-[#c9e7a4]" : "")
                }
              />
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
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
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
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

      <section className="forest-panel overflow-hidden rounded-[1.65rem] bg-[#1c3934] text-white shadow-[0_20px_60px_rgba(24,58,46,0.14)]">
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
                <span className="text-xs font-semibold text-[#8fb3a2]">
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
            className="text-sm font-semibold text-[#3d6857] hover:text-[#1c3934]"
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
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
            Only the tools assigned to your role appear here.
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-fit border-[#cddbd6] bg-white px-3 py-1.5 text-[#40585b]"
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
        <div className="mt-8 rounded-3xl border border-dashed border-[#bdcbc7] bg-white p-10 text-center text-[#647577]">
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
      <section className="surface rounded-[1.5rem] border border-[#d9e2df] bg-white p-8">
        <p className="eyebrow">Personal workspace</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
          My Recharge
        </h1>
        <p className="mt-4 text-base text-[#647577]">
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
      <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
        Clock in, check your schedule and review your performance.
      </p>

      <Tabs defaultValue="clock" className="mt-8">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-[#e6eeea] p-1 sm:w-fit">
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
          <section className="forest-panel overflow-hidden rounded-[1.65rem] bg-[#1c3934] text-white shadow-[0_20px_60px_rgba(24,58,46,0.14)]">
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
                    ? "bg-white text-[#1c3934] hover:bg-white/90"
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
          <section className="surface mt-5 rounded-[1.5rem] border border-[#d9e2df] bg-white p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Recent time</h2>
            {data.recentEntries.length ? (
              <div className="mt-4 divide-y divide-[#e7ecea]">
                {data.recentEntries.map((entry) => (
                  <div
                    className="flex flex-col justify-between gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                    key={entry.id}
                  >
                    <span className="text-sm font-medium">
                      {formatDateTime(entry.clockIn)}
                    </span>
                    <span className="text-sm text-[#718184]">
                      {entry.clockOut
                        ? `${formatTime(entry.clockIn)}–${formatTime(entry.clockOut)}`
                        : "In progress"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#718184]">
                Your first clock-in will appear here.
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="schedule" className="mt-6">
          <section className="surface rounded-[1.5rem] border border-[#d9e2df] bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Next seven days</p>
                <h2 className="mt-2 text-2xl font-semibold">Your schedule</h2>
              </div>
              <Badge className="border-0 bg-[#dfe9e4] text-[#36561d]">
                {data.schedule.length} shifts
              </Badge>
            </div>
            {data.schedule.length ? (
              <div className="mt-5 space-y-3">
                {data.schedule.map((shift) => (
                  <div
                    className="flex flex-col justify-between gap-3 rounded-xl border border-[#e1e8e5] p-4 sm:flex-row sm:items-center"
                    key={shift.id}
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {formatShiftDate(shift.shiftDate)}
                      </p>
                      <p className="mt-1 text-sm text-[#718184]">{shift.label}</p>
                    </div>
                    <p className="text-sm font-semibold text-[#315f4d]">
                      {shift.startTime}–{shift.endTime}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-xl bg-[#f3f6f4] px-5 py-8 text-center">
                <p className="text-sm font-medium">No shifts assigned</p>
                <p className="mt-1 text-sm text-[#718184]">
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
          <p className="mt-4 text-sm text-[#718184]">
            Performance updates automatically from your recorded time.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PerformanceStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="surface rounded-[1.4rem] border border-[#d9e2df] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[#718184]">
        {label}
      </p>
      <p className="mt-7 text-4xl font-semibold tracking-[-0.05em]">{value}</p>
    </article>
  );
}

function OperationsSection({
  section,
  firstName,
  index,
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
  firstName: string;
  index: number;
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
  onOpenWorkflowBoard: (mode: "onboarding-invoices" | "new-property-inspections") => void;
}) {
  const Icon = section.icon;
  const [toolSearch, setToolSearch] = useState("");
  const filteredModules = modules.filter((module) =>
    `${module.name} ${module.description} ${module.category}`
      .toLowerCase()
      .includes(toolSearch.trim().toLowerCase()),
  );

  const openable = modules.filter(
    (module) => module.url || liveInternalModules.has(module.id),
  ).length;
  const planned = modules.length - openable;

  return (
    <>
      <section className="forest-panel overflow-hidden rounded-[1.75rem] px-5 pb-5 pt-6 shadow-[0_30px_70px_-30px_rgba(16,39,31,0.55)] sm:rounded-[2rem] sm:px-9 sm:pb-8 sm:pt-9">
        <span className="orb -right-16 -top-20 size-72 bg-[#8fb3a2]/35" aria-hidden="true" />
        <span
          className="orb -bottom-24 left-1/3 size-64 bg-[#c9e7a4]/15"
          style={{ animationDelay: "-7s", animationDuration: "24s" }}
          aria-hidden="true"
        />
        <svg
          className="ring-spin pointer-events-none absolute -right-24 top-1/2 hidden size-[26rem] -translate-y-1/2 text-white/[0.07] md:block"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 5" />
          <circle cx="100" cy="100" r="74" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="50" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="1 3" />
        </svg>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/10 text-[#c9e7a4] backdrop-blur">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#8fb3a2]">
                Department {String(index + 1).padStart(2, "0")}
              </p>
            </div>
            {firstName && (
              <p className="mt-6 text-sm sm:mt-7 font-medium text-white/55">
                Good {dayPart()}, {firstName}
              </p>
            )}
            <h1 className={(firstName ? "mt-1.5" : "mt-6 sm:mt-7") + " text-[2.6rem] font-semibold leading-[0.95] tracking-[-0.05em] sm:text-6xl"}>
              Recharge{" "}
              <span className="font-display text-[#c9e7a4]">{section.label}</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/60 sm:text-[0.95rem] sm:leading-7">
              {section.description}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-2 sm:gap-3 lg:min-w-[22rem]">
            <HeroStat label="Tools" value={modules.length} />
            <HeroStat label="Ready" value={openable} live />
            <HeroStat label="Planned" value={planned} />
          </dl>
        </div>

        <div className="relative mt-7 sm:mt-9">
          <Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-white/55" />
          <input
            className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.07] pl-11 pr-24 text-sm text-white outline-none backdrop-blur transition-all duration-300 placeholder:text-white/40 hover:bg-white/[0.1] focus:border-[#c9e7a4]/50 focus:bg-white/[0.12] focus:shadow-[0_0_0_4px_rgba(201,231,164,0.12)] lg:max-w-xl"
            value={toolSearch}
            onChange={(event) => setToolSearch(event.target.value)}
            placeholder={`Search ${section.label} tools`}
            aria-label={`Search ${section.label} tools`}
          />
          {toolSearch && (
            <button
              className="press absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:left-[calc(36rem-4.5rem)] lg:right-auto"
              onClick={() => setToolSearch("")}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {section.id !== "cleans" && (
        <WorkflowPanels section={section.id} data={workflowData} />
      )}

      {filteredModules.length > 0 ? (
        <section className="mt-8 sm:mt-10">
        <div className="mb-4 flex items-end justify-between gap-4 px-1">
          <div>
            <p className="eyebrow">Toolkit</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
              {toolSearch ? "Matching tools" : "Your tools"}
            </h2>
          </div>
          <span className="rounded-full border border-[#d6e1dc] bg-white/70 px-3 py-1 text-xs font-semibold text-[#527261]">
            {filteredModules.length} of {modules.length}
          </span>
        </div>
        <div key={toolSearch ? "search" : "all"} className="stagger grid gap-3 sm:grid-cols-2 sm:gap-4 2xl:grid-cols-3">
          {filteredModules.map((module, moduleIndex) => (
            <ToolCard
              key={module.id}
              order={moduleIndex}
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
        </section>
      ) : modules.length === 0 ? (
        <section className="mt-8 rounded-[1.5rem] border border-dashed border-[#bdcbc7] bg-white/70 px-6 py-14 text-center backdrop-blur sm:px-10">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#eef4f0] text-[#4a705f]">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-semibold">No tools connected yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#647577]">
            This section is ready for the {section.label.toLowerCase()} tools we
            add next.
          </p>
        </section>
      ) : (
        <section className="mt-8 rounded-[1.5rem] border border-dashed border-[#bdcbc7] bg-white/70 px-6 py-14 text-center backdrop-blur sm:px-10">
          <Search className="mx-auto size-6 text-[#6f827b]" />
          <h2 className="mt-4 text-xl font-semibold">No matching tools</h2>
          <p className="mt-2 text-sm text-[#647577]">Try a different name or keyword.</p>
        </section>
      )}
    </>
  );
}

function HeroStat({ label, value, live = false }: { label: string; value: number; live?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 backdrop-blur sm:px-4 sm:py-4">
      <dt className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/45">
        {live && <span className="live-dot" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-3xl">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const start = performance.now();
    const duration = reduced ? 1 : 900;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(Math.round(value * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <>{display}</>;
}

function ToolCard({
  module,
  large = false,
  order = 0,
  onOpen,
}: {
  module: ModuleCard;
  large?: boolean;
  order?: number;
  onOpen?: () => void;
}) {
  const Icon = icons[module.id];

  function trackPointer(event: MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  // The whole card is one target; the action link stretches over it.
  const stretch = "after:absolute after:inset-0 after:rounded-[inherit] after:content-['']";

  return (
    <article
      className={"tool-card group " + (large ? "sm:min-h-56" : "")}
      style={{ "--i": order } as React.CSSProperties}
      onMouseMove={trackPointer}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="tool-icon grid size-11 shrink-0 place-items-center rounded-2xl">
          <Icon className="size-[1.15rem]" />
        </div>
        <span className="rounded-full border border-[#e3eae7] bg-[#f6f8f7] px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[#6a7d79]">
          {module.audience}
        </span>
      </div>
      <div className="mt-4 sm:mt-7">
        <h3 className="text-[1.05rem] font-semibold tracking-[-0.025em] sm:text-lg">
          {module.name}
        </h3>
        <p className="mt-1.5 line-clamp-2 max-w-xl text-sm leading-6 text-[#6b7b7d] sm:line-clamp-3">
          {module.description}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e8eeeb] pt-3.5 sm:mt-5 sm:pt-4">
        <span className="truncate text-xs font-medium text-[#849294]">
          {module.category}
        </span>
        {onOpen ? (
          <button
            className={"tool-cta inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#1c3934] focus-visible:outline-none " + stretch + " focus-visible:after:ring-2 focus-visible:after:ring-[#315f50]"}
            onClick={onOpen}
          >
            <span className="tool-cta-pill inline-flex items-center gap-1.5 rounded-full bg-[#eef3f0] py-1.5 pl-3.5 pr-2.5">
              Open centre
              <ArrowUpRight className="size-3.5" />
            </span>
          </button>
        ) : module.url ? (
          <a
            className={"tool-cta inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#1c3934] focus-visible:outline-none " + stretch + " focus-visible:after:ring-2 focus-visible:after:ring-[#315f50]"}
            href={"/tool/" + module.id}
            target="_blank"
            rel="noreferrer"
          >
            <span className="tool-cta-pill inline-flex items-center gap-1.5 rounded-full bg-[#eef3f0] py-1.5 pl-3.5 pr-2.5">
              Open tool
              <ArrowUpRight className="size-3.5" />
            </span>
          </a>
        ) : liveInternalModules.has(module.id) ? (
          <span className="inline-flex shrink-0 items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#436352]">
            <span className="live-dot" />
            Live workflow
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-dashed border-[#c9d6d1] px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-[#7a8c86]">
            Planned
          </span>
        )}
      </div>
    </article>
  );
}

function Access({ accessUsers }: { accessUsers: AccessUser[] }) {
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
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
            Approve account requests, assign roles and control every user’s tool access.
          </p>
        </div>
        <AccessDialog />
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        <span className="rounded-full border border-[#d6e2de] bg-white px-4 py-2 text-sm font-semibold text-[#47645e]">
          {active} active
        </span>
        <span className={`rounded-full border px-4 py-2 text-sm font-semibold ${pending ? "border-amber-200 bg-amber-50 text-amber-800" : "border-[#d6e2de] bg-white text-[#73827f]"}`}>
          {pending} pending approval
        </span>
      </div>

      <section className="surface mt-8 overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
        <div className="hidden grid-cols-[1.2fr_0.75fr_0.65fr_1.45fr_auto] gap-5 border-b border-[#e2e9e7] bg-[#f6f8f7] px-6 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#718184] lg:grid">
          <span>User</span>
          <span>Account type</span>
          <span>Status</span>
          <span>Tool access</span>
          <span />
        </div>
        {accessUsers.map((user) => (
          <div
            className={`grid gap-4 border-b border-[#e6ecea] px-5 py-5 last:border-0 lg:grid-cols-[1.2fr_0.75fr_0.65fr_1.45fr_auto] lg:items-center lg:px-6 ${user.status === "pending" ? "bg-amber-50/45" : ""}`}
            key={user.email}
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-[#edf5f0] text-sm font-bold text-[#315c61]">
                {initials(user.fullName || user.email)}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {user.fullName || "Unnamed user"}
                </p>
                <p className="mt-0.5 text-xs text-[#7c8b8d]">{user.email}</p>
              </div>
            </div>
            <div>
              <Badge
                variant="outline"
                className="border-[#d6e0dd] bg-[#fbfcfc] text-[#476064]"
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
                  className="rounded-md bg-[#eef3f1] px-2 py-1 text-[0.68rem] font-medium text-[#4c6669]"
                  key={moduleId}
                >
                  {MODULES.find((module) => module.id === moduleId)?.shortName}
                </span>
              ))}
              {user.modules.length > 5 && (
                <span className="rounded-md bg-[#f5f7f6] px-2 py-1 text-[0.68rem] font-semibold text-[#687976]">
                  +{user.modules.length - 5} more
                </span>
              )}
              {user.modules.length === 0 && (
                <span className="text-xs text-[#879491]">No tools selected</span>
              )}
            </div>
            <div>
              {user.email === "enquiries@rechargestays.co.uk" ? (
                <span className="text-xs font-medium text-[#879491]">Primary owner</span>
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
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {user ? (
          <Button variant="outline" className="rounded-xl border-[#cad8d4] bg-white">
            Manage
          </Button>
        ) : (
          <Button className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]">
            <Plus /> {teamOnly ? "Add team member" : "Add account"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">
              {user ? "Manage account" : teamOnly ? "Add a team member" : "Add an account"}
            </DialogTitle>
            <DialogDescription>
              {user
                ? "Change this person’s role, status and individual tool access."
                : teamOnly ? "Add the person, choose their department and record what they are responsible for." : "Create active access using the email this person uses to sign in."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 px-6 py-6">
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
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!teamOnly && <SelectItem value="client">Client</SelectItem>}
                  <SelectItem value="stays">Stays employee</SelectItem>
                  <SelectItem value="cleans">Cleans employee</SelectItem>
                  <SelectItem value="ready">Ready employee</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
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
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending approval</SelectItem>
                    <SelectItem value="revoked">Disabled</SelectItem>
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
                {role !== "admin" && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#45675f] hover:text-[#1c3934]"
                    onClick={() => setSelected(defaultModulesForRole(role))}
                  >
                    Reset to role defaults
                  </button>
                )}
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {MODULES.map((module) => {
                  const checked = selected.includes(module.id);
                  return (
                    <label
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#dce5e2] p-3.5 hover:bg-[#f5f8f7]"
                      key={module.id}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={role === "admin"}
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
                        <span className="mt-0.5 block text-xs text-[#78888a]">
                          {module.audience}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-5">
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
                saving ||
                (status === "active" && role !== "admin" && selected.length === 0)
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
    revoked: "Disabled",
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
          ? "border-[#315f50] bg-[#e5eeea]"
          : "border-[#d9e2df] bg-white")
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[#718184]">
          {label}
        </p>
        <Icon className="size-4 text-[#739195]" />
      </div>
      <p className="mt-8 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-2 text-xs text-[#829092]">{note}</p>
    </article>
  );
}

function NavHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.24em] text-white/30">
      {children}
    </p>
  );
}

function NavButton({
  active,
  inside = false,
  icon: Icon,
  index,
  label,
  order = 0,
  onClick,
}: {
  active: boolean;
  inside?: boolean;
  icon: typeof Home;
  index: string;
  label: string;
  order?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={"nav-button " + (active ? "nav-button-active" : inside ? "text-white/85" : "")}
      style={{ "--i": order } as React.CSSProperties}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="text-[0.62rem] font-semibold tabular-nums tracking-[0.08em] text-white/30">
        {index}
      </span>
      <Icon className="size-[1.05rem]" />
      <span>{label}</span>
      {inside && <span className="size-1.5 rounded-full bg-[#c9e7a4]/80" aria-hidden="true" />}
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

function departmentForView(
  view: View,
  context: {
    maintenanceWorkspace: MaintenanceWorkspace;
    cleansMode: CleansMode;
    purchaseOrderWorkspace: PurchaseOrderWorkspace;
    operationsMode: OperationsMode;
    onboardingMode: "client" | "staff";
  },
): OperationsView | null {
  if (operationsSections.some((section) => section.id === view)) {
    return view as OperationsView;
  }
  switch (view) {
    case "communications":
    case "property-database":
      return "stays";
    case "client-properties":
    case "client-calendar":
      return "clients";
    case "owner-statements":
    case "onboarding-invoices-board":
      return "accounts";
    case "new-property-inspections-board":
      return "ready";
    case "onboarding":
      return context.onboardingMode === "client" ? "clients" : "stays";
    case "maintenance":
      return context.maintenanceWorkspace === "ready"
        ? "ready"
        : context.maintenanceWorkspace === "accounts"
          ? "accounts"
          : context.maintenanceWorkspace === "client"
            ? "clients"
            : "stays";
    case "cleans-centre":
      return context.cleansMode === "client-mailbox"
        ? "clients"
        : context.cleansMode === "replenishment-requests"
          ? "accounts"
          : context.cleansMode === "clean-reporting"
            ? "stays"
            : "cleans";
    case "purchase-orders":
      return context.purchaseOrderWorkspace === "client"
        ? "clients"
        : context.purchaseOrderWorkspace === "accounts"
          ? "accounts"
          : context.purchaseOrderWorkspace === "stays"
            ? "stays"
            : "ready";
    case "operations-centre":
      return context.operationsMode === "ready-calendar" ||
        context.operationsMode === "routine-maintenance"
        ? "ready"
        : context.operationsMode === "direct-booking-accounts"
          ? "accounts"
          : "stays";
    default:
      return null;
  }
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
