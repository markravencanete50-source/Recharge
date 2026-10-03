"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Network,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AccessStatus, type ModuleId, type WorkspaceRole } from "@/lib/modules";
import type { TeamCustomRole, TeamStructureData } from "@/lib/team";

type TeamDepartment = "leadership" | "stays" | "cleans" | "ready" | "marketing" | "accounts";
type AccessTeamMember = {
  email: string;
  fullName: string;
  responsibilities: string;
  role: WorkspaceRole;
  modules: ModuleId[];
  status: AccessStatus;
};
type TeamMember = {
  id: string;
  directoryId?: string;
  email?: string;
  fullName: string;
  responsibilities: string;
  role: TeamDepartment;
  modules: ModuleId[];
  status: AccessStatus | "vacancy";
  roleIds?: string[];
  regions?: string[];
  source: "directory" | "access";
};

const OWNER_EMAIL = "enquiries@rechargestays.co.uk";
const departments: Array<{ role: TeamDepartment; label: string; description: string }> = [
  { role: "leadership", label: "Leadership", description: "Company direction, management decisions and cross-department oversight." },
  { role: "stays", label: "Recharge Stays", description: "Property management, guest operations, pricing and owner relationships." },
  { role: "cleans", label: "Recharge Cleans", description: "Cleaning delivery, schedules, standards and laundry coordination." },
  { role: "ready", label: "Recharge Ready", description: "Inspections, furnishing, maintenance and property readiness." },
  { role: "marketing", label: "Marketing", description: "Brand, campaigns, content, lead generation and communications." },
  { role: "accounts", label: "Accounts", description: "Invoices, payments, reconciliation, owner statements and financial controls." },
];
const roleNames: Record<TeamDepartment, string> = {
  leadership: "Leadership",
  stays: "Recharge Stays",
  cleans: "Recharge Cleans",
  ready: "Recharge Ready",
  marketing: "Marketing",
  accounts: "Accounts",
};
const regionPoints: Record<string, [number, number]> = {
  "Highlands & Islands": [205, 104],
  Moray: [265, 132],
  "Aberdeen & Aberdeenshire": [322, 155],
  "Perth & Kinross": [250, 218],
  "Angus & Dundee": [305, 212],
  "Argyll & Bute": [176, 230],
  "Stirling & Falkirk": [232, 274],
  Fife: [291, 271],
  "Edinburgh & Lothians": [318, 311],
  "Glasgow & Clyde": [204, 313],
  Lanarkshire: [239, 343],
  Ayrshire: [174, 359],
  Borders: [301, 369],
  "Dumfries & Galloway": [230, 407],
};

export function TeamClient({
  users,
  isAdmin,
  currentUserName,
  signOutPath,
  embedded = false,
}: {
  users: AccessTeamMember[];
  isAdmin: boolean;
  currentUserName: string;
  signOutPath: string;
  embedded?: boolean;
}) {
  const [structure, setStructure] = useState<TeamStructureData>({ roles: [], coverage: [], regions: [], schedules: [], people: [] });
  const teamMembers = useMemo(() => {
    const directoryEmails = new Set(structure.people.map((person) => person.email).filter(Boolean));
    const directory: TeamMember[] = structure.people.map((person) => ({
      id: "person:" + person.id,
      directoryId: person.id,
      email: person.email || undefined,
      fullName: person.fullName,
      responsibilities: person.responsibilities,
      role: normalizeDepartment(person.department),
      modules: [],
      status: person.status,
      roleIds: person.roleIds,
      regions: person.regions,
      source: "directory",
    }));
    const access: TeamMember[] = (Array.isArray(users) ? users : [])
      .filter((user) => user.role !== "client" && !directoryEmails.has(user.email))
      .map((user) => ({
        ...user,
        id: "access:" + user.email,
        role: user.role === "admin" ? "leadership" : user.role as TeamDepartment,
        source: "access" as const,
      }));
    return [...directory, ...access].filter((member) => isAdmin || member.status === "active");
  }, [users, structure.people, isAdmin]);
  const [editing, setEditing] = useState<TeamMember | "new" | null>(null);
  const [roleEditor, setRoleEditor] = useState<TeamCustomRole | "new" | null>(null);
  const [scheduleEditor, setScheduleEditor] = useState<TeamDepartment | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/team", { cache: "no-store" });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) setStructure(result.data);
    else setError(result?.error || "Team information could not be loaded.");
  }

  useEffect(() => {
    void load();
  }, []);

  const directory = (
    <>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#55736a]">Recharge people</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Team</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
            See who owns each responsibility, when departments are working and where every role operates.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => setRoleEditor("new")}>
              <BriefcaseBusiness className="size-4" /> Add role
            </button>
            <button className="primary-button" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Add team member
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <Tabs defaultValue="people" className="mt-8">
        <TabsList className="h-auto max-w-full flex-wrap justify-start rounded-xl bg-[#dfe9e4] p-1">
          <TabsTrigger value="people">People &amp; roles</TabsTrigger>
          <TabsTrigger value="schedules">Department schedules</TabsTrigger>
          <TabsTrigger value="hierarchy">Management hierarchy</TabsTrigger>
          <TabsTrigger value="coverage">Scotland coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="mt-6">
          <PeopleDirectory
            members={teamMembers}
            structure={structure}
            isAdmin={isAdmin}
            onEditMember={setEditing}
            onEditRole={setRoleEditor}
          />
        </TabsContent>
        <TabsContent value="schedules" className="mt-6">
          <DepartmentSchedules
            members={teamMembers}
            structure={structure}
            isAdmin={isAdmin}
            onAdd={setScheduleEditor}
            onChanged={setStructure}
          />
        </TabsContent>
        <TabsContent value="hierarchy" className="mt-6">
          <HierarchyTree
            members={teamMembers}
            structure={structure}
            isAdmin={isAdmin}
            onEdit={setRoleEditor}
          />
        </TabsContent>
        <TabsContent value="coverage" className="mt-6">
          <CoverageMap members={teamMembers} structure={structure} />
        </TabsContent>
      </Tabs>
      {editing && (
        <TeamMemberEditor
          member={editing === "new" ? undefined : editing}
          structure={structure}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setStructure(next);
            setEditing(null);
          }}
        />
      )}
      {roleEditor && (
        <RoleEditor
          role={roleEditor === "new" ? undefined : roleEditor}
          structure={structure}
          onClose={() => setRoleEditor(null)}
          onSaved={(next) => {
            setStructure(next);
            setRoleEditor(null);
          }}
        />
      )}
      {scheduleEditor && (
        <ScheduleEditor
          department={scheduleEditor}
          members={teamMembers}
          onClose={() => setScheduleEditor(null)}
          onSaved={(next) => {
            setStructure(next);
            setScheduleEditor(null);
          }}
        />
      )}
    </>
  );

  if (embedded) return <div className="space-y-8">{directory}</div>;
  return (
    <div className="min-h-screen bg-[#f0f4f1] text-[#1c3934]">
      <header className="sticky top-0 z-20 border-b border-[#d9e2df] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[92rem] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-4">
            <a className="grid size-10 place-items-center rounded-xl border border-[#d9e2df] bg-white hover:bg-[#f3f6f5]" href="/" aria-label="Back to Recharge">
              <ArrowLeft className="size-5" />
            </a>
            <div><p className="font-semibold">Team</p><p className="text-sm text-[#718184]">Recharge company directory</p></div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-medium sm:inline">{currentUserName}</span>
            <a className="text-sm font-semibold text-[#49675f]" href={signOutPath}>Sign out</a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[92rem] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">{directory}</main>
    </div>
  );
}

function PeopleDirectory({
  members,
  structure,
  isAdmin,
  onEditMember,
  onEditRole,
}: {
  members: TeamMember[];
  structure: TeamStructureData;
  isAdmin: boolean;
  onEditMember: (member: TeamMember) => void;
  onEditRole: (role: TeamCustomRole) => void;
}) {
  return (
    <div className="space-y-6">
      {departments.map((department) => {
        const people = members.filter((member) => member.role === department.role);
        const roles = structure.roles.filter((role) => normalizeDepartment(role.department) === department.role);
        return (
          <section key={department.role} className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white shadow-[0_8px_30px_rgba(28,57,52,.04)]">
            <div className="flex flex-col justify-between gap-3 border-b border-[#e2e9e7] bg-[#f7f9f8] px-5 py-5 sm:flex-row sm:items-start sm:px-6">
              <div className="flex gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#dce7e2] text-[#315f50]">
                  {department.role === "leadership" ? <ShieldCheck className="size-5" /> : <Users className="size-5" />}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">{department.label}</h2>
                  <p className="mt-1 text-sm leading-6 text-[#647577]">{department.description}</p>
                </div>
              </div>
              <span className="w-fit rounded-full border border-[#d6e0dd] bg-white px-3 py-1 text-sm font-semibold text-[#526b65]">{people.length}</span>
            </div>
            {roles.length > 0 && (
              <div className="grid gap-3 border-b border-[#e6ecea] bg-[#fbfcfb] p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
                {roles.map((role) => (
                  <article key={role.id} className="rounded-2xl border border-[#dce5e2] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{role.name}</h3>
                        <p className="mt-1 text-xs text-[#718184]">{people.filter((member) => memberRoleIds(member, structure).includes(role.id)).length} assigned · {formatRegions(role.regions)}</p>
                      </div>
                      {isAdmin && <button className="icon-button" onClick={() => onEditRole(role)} aria-label={"Edit " + role.name}><Pencil className="size-4" /></button>}
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm text-[#405956]">
                      {(role.responsibilities.length ? role.responsibilities : ["No responsibilities added yet."]).map((item) => (
                        <li key={item} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#4f7568]" /><span>{item}</span></li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
            {people.length ? (
              <div className="divide-y divide-[#e6ecea]">
                {people.map((member) => {
                  const assigned = structure.roles.filter((role) => memberRoleIds(member, structure).includes(role.id));
                  const areas = memberRegions(member, structure);
                  return (
                    <article key={member.id} className={"grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)_auto] lg:items-start " + (member.status === "vacancy" ? "bg-amber-50/45" : "")}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={"grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold " + (member.status === "vacancy" ? "bg-amber-100 text-amber-800" : "bg-[#1c3934] text-white")}>{member.status === "vacancy" ? <BriefcaseBusiness className="size-5" /> : initials(member.fullName || member.email || "")}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{member.fullName || "Open vacancy"}</h3>
                            {isAdmin && <StatusPill status={member.status} />}
                          </div>
                          <p className="mt-1 text-sm text-[#718184]">{member.status === "vacancy" ? "Position not yet filled" : roleNames[member.role]}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">{assigned.map((role) => <span key={role.id} className="rounded-full bg-[#dfe9e4] px-2.5 py-1 text-xs font-semibold">{role.name}</span>)}</div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-[#f3f6f5] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#60756f]">Personal responsibilities</p>
                          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#405956]">{member.responsibilities || "No individual responsibilities have been added yet."}</p>
                        </div>
                        {areas.length > 0 && <div className="flex flex-wrap gap-2">{areas.map((area) => <RegionPill key={area} area={area} />)}</div>}
                      </div>
                      {isAdmin && member.email !== OWNER_EMAIL ? <button className="secondary-button" onClick={() => onEditMember(member)}>Manage</button> : null}
                    </article>
                  );
                })}
              </div>
            ) : <p className="px-6 py-8 text-sm text-[#7b8987]">No team members have been added to this department.</p>}
          </section>
        );
      })}
    </div>
  );
}

function DepartmentSchedules({
  members,
  structure,
  isAdmin,
  onAdd,
  onChanged,
}: {
  members: TeamMember[];
  structure: TeamStructureData;
  isAdmin: boolean;
  onAdd: (department: TeamDepartment) => void;
  onChanged: (data: TeamStructureData) => void;
}) {
  const [department, setDepartment] = useState<TeamDepartment>("stays");
  const items = structure.schedules.filter((item) => normalizeDepartment(item.department) === department);
  const memberName = (id: string) => members.find((member) => member.id === id || member.email === id)?.fullName || id;

  async function remove(id: string) {
    if (!window.confirm("Remove this schedule item?")) return;
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove_schedule", id }),
    });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) onChanged(result.data);
  }

  return (
    <section className="overflow-hidden rounded-[1.7rem] border border-[#d9e2df] bg-white">
      <div className="flex flex-col justify-between gap-4 border-b border-[#dfe7e4] bg-[#f7f9f8] p-5 sm:flex-row sm:items-center sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#60756f]">Department schedule</p>
          <h2 className="mt-1 text-2xl font-semibold">{roleNames[department]}</h2>
          <p className="mt-1 text-sm text-[#718184]">Shifts, meetings, inspections and recurring department work.</p>
        </div>
        {isAdmin && <button className="primary-button" onClick={() => onAdd(department)}><Plus className="size-4" /> Add schedule item</button>}
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-[#e3e9e7] px-5 py-4 sm:px-6">
        {departments.map((item) => (
          <button key={item.role} onClick={() => setDepartment(item.role)} className={"whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold " + (department === item.role ? "bg-[#1c3934] text-white" : "bg-[#edf2f0] text-[#49645d]")}>{item.label}</button>
        ))}
      </div>
      <div className="p-5 sm:p-6">
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.id} className="grid gap-4 rounded-2xl border border-[#dce5e2] p-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="font-semibold">{formatDate(item.scheduleDate)}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#60756f]"><Clock3 className="size-4" />{item.startTime}–{item.endTime}</p>
                </div>
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-[#718184]">{item.assignedEmail ? memberName(item.assignedEmail) : "Whole department"}{item.note ? " · " + item.note : ""}</p>
                </div>
                {isAdmin && <button className="icon-button text-red-700" onClick={() => void remove(item.id)} aria-label="Remove schedule item"><Trash2 className="size-4" /></button>}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#cbd7d3] px-5 py-14 text-center">
            <CalendarDays className="mx-auto size-7 text-[#5f776f]" />
            <p className="mt-3 font-semibold">No schedule items yet</p>
            <p className="mt-1 text-sm text-[#718184]">Add this department’s first shift, meeting or scheduled job.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function HierarchyTree({
  members,
  structure,
  isAdmin,
  onEdit,
}: {
  members: TeamMember[];
  structure: TeamStructureData;
  isAdmin: boolean;
  onEdit: (role: TeamCustomRole) => void;
}) {
  const roles = structure.roles;
  const roots = roles.filter((role) => !role.parentRoleId || !roles.some((item) => item.id === role.parentRoleId));
  const renderRole = (role: TeamCustomRole, lineage: string[] = []): ReactNode => {
    if (lineage.includes(role.id)) return null;
    const children = roles.filter((item) => item.parentRoleId === role.id);
    const assigned = members.filter((member) => memberRoleIds(member, structure).includes(role.id));
    return (
      <li key={role.id}>
        <article className="org-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#60756f]">{roleNames[normalizeDepartment(role.department)] || role.department}</p>
              <h3 className="mt-1 text-lg font-semibold">{role.name}</h3>
            </div>
            {isAdmin && <button className="icon-button" onClick={() => onEdit(role)} aria-label={"Edit " + role.name}><Pencil className="size-4" /></button>}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {assigned.length ? assigned.map((member) => <span key={member.id} className={"rounded-full px-2.5 py-1 text-xs font-semibold " + (member.status === "vacancy" ? "bg-amber-100 text-amber-800" : "bg-[#dfe9e4] text-[#315f50]")}>{member.status === "vacancy" ? "Vacancy" : member.fullName}</span>) : <span className="rounded-full bg-[#edf2f0] px-2.5 py-1 text-xs text-[#718184]">Unassigned</span>}
          </div>
          <p className="mt-3 text-xs text-[#718184]">{formatRegions(role.regions)}</p>
        </article>
        {children.length > 0 && <ul>{children.map((child) => renderRole(child, [...lineage, role.id]))}</ul>}
      </li>
    );
  };
  return (
    <section className="overflow-hidden rounded-[1.7rem] border border-[#d9e2df] bg-[#f7f9f8] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-[#dce7e2]"><Network className="size-5" /></div>
        <div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#60756f]">Reporting structure</p><h2 className="mt-1 text-2xl font-semibold">Management hierarchy</h2></div>
      </div>
      <p className="mt-3 text-sm text-[#718184]">The top role sits at the peak. Each level beneath shows who reports into whom.</p>
      <div className="org-tree mt-8 overflow-x-auto pb-8"><ul>{roots.map((role) => renderRole(role))}</ul></div>
      {!roles.length && <p className="mt-6 rounded-2xl border border-dashed border-[#cbd7d3] bg-white p-10 text-center text-sm text-[#718184]">Add roles to build the management hierarchy.</p>}
    </section>
  );
}

function CoverageMap({ members, structure }: { members: TeamMember[]; structure: TeamStructureData }) {
  const [selectedRole, setSelectedRole] = useState("all");
  const [region, setRegion] = useState("all");
  const role = structure.roles.find((item) => item.id === selectedRole);
  const roleMembers = role ? members.filter((member) => memberRoleIds(member, structure).includes(role.id)) : members;
  const roleRegions = role?.regions.includes("General") ? Object.keys(regionPoints) : role?.regions;
  const visible = roleMembers.filter((member) => {
    if (region === "all") return true;
    const personRegions = memberRegions(member, structure);
    return Boolean(roleRegions?.includes(region) || personRegions.includes("General") || personRegions.includes(region));
  });
  const coverageFor = (area: string) => {
    if (role && roleRegions?.includes(area)) return roleMembers;
    return roleMembers.filter((member) => {
      const areas = memberRegions(member, structure);
      return areas.includes("General") || areas.includes(area);
    });
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,.75fr)]">
      <section className="overflow-hidden rounded-[1.7rem] border border-[#d9e2df] bg-[#e8efec]">
        <div className="flex flex-col justify-between gap-4 border-b border-[#cfdbd7] bg-white p-5 sm:flex-row sm:items-center">
          <div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#60756f]">Scotland coverage</p><h2 className="mt-1 text-2xl font-semibold">Role coverage by area</h2></div>
          <select className="field max-w-xs bg-white" value={selectedRole} onChange={(event) => { setSelectedRole(event.target.value); setRegion("all"); }}>
            <option value="all">All roles</option>
            {structure.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        {role?.regions.includes("General") && <p className="mx-5 mt-5 rounded-xl bg-[#1c3934] px-4 py-3 text-sm font-semibold text-white sm:mx-6">General coverage — this role operates across Scotland.</p>}
        <div className="relative min-h-[34rem] p-4 sm:p-6">
          <svg viewBox="0 0 470 520" className="mx-auto h-[34rem] w-full max-w-[35rem]" role="img" aria-label="Scotland team coverage map">
            <path d="M188 35 241 49 268 80 316 96 351 139 342 181 318 202 328 234 307 261 338 296 329 333 355 366 323 405 286 428 262 476 218 461 191 425 152 412 137 373 111 340 127 302 103 268 128 232 120 198 150 168 144 126 169 96Z" fill="#d7e5df" stroke="#68847a" strokeWidth="3" />
            <path d="M82 116 105 102 116 122 98 142 76 137ZM91 178 113 166 119 188 99 202 82 194Z" fill="#d7e5df" stroke="#68847a" strokeWidth="2" />
            {Object.entries(regionPoints).map(([area, [x, y]]) => {
              const count = coverageFor(area).length;
              const active = region === "all" || region === area;
              return <g key={area} role="button" tabIndex={0} aria-label={area + ": " + count + " people"} onClick={() => setRegion(region === area ? "all" : area)} className="cursor-pointer"><circle cx={x} cy={y} r={count ? 18 : 12} fill={count ? active ? "#1c3934" : "#789088" : "#f7faf8"} stroke="#315f50" strokeWidth="2" /><text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill={count ? "white" : "#526b65"}>{count}</text></g>;
            })}
          </svg>
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
            <p className="text-sm font-semibold">{region === "all" ? "Select a map marker to focus on an area" : region}</p>
            <p className="mt-1 text-xs text-[#647577]">Markers combine role coverage with individual team member coverage.</p>
          </div>
        </div>
      </section>
      <section className="rounded-[1.7rem] border border-[#d9e2df] bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#60756f]">Coverage directory</p><h2 className="mt-1 text-2xl font-semibold">{visible.length} team members</h2></div>
          {region !== "all" && <button className="text-sm font-semibold text-[#315f50]" onClick={() => setRegion("all")}>Clear</button>}
        </div>
        <div className="mt-5 space-y-3">
          {visible.map((member) => {
            const assigned = structure.roles.filter((item) => memberRoleIds(member, structure).includes(item.id));
            const areas = memberRegions(member, structure);
            return <article key={member.id} className="rounded-2xl border border-[#dce4e1] p-4"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-[#1c3934] text-xs font-bold text-white">{initials(member.fullName)}</div><div><h3 className="font-semibold">{member.fullName || "Open vacancy"}</h3><p className="text-sm text-[#718184]">{roleNames[member.role]}</p></div></div><div className="mt-3 flex flex-wrap gap-1.5">{assigned.map((item) => <span key={item.id} className="rounded-full bg-[#e5eee9] px-2.5 py-1 text-xs font-semibold">{item.name}</span>)}</div><p className="mt-3 text-xs leading-5 text-[#60756f]">{areas.length ? areas.join(" · ") : "No individual coverage areas assigned"}</p></article>;
          })}
          {!visible.length && <p className="rounded-2xl border border-dashed border-[#c8d4d0] p-8 text-center text-sm text-[#718184]">No one is assigned to this combination yet.</p>}
        </div>
      </section>
    </div>
  );
}

function TeamMemberEditor({ member, structure, onClose, onSaved }: { member?: TeamMember; structure: TeamStructureData; onClose: () => void; onSaved: (data: TeamStructureData) => void }) {
  const [department, setDepartment] = useState<TeamDepartment>(member?.role || "stays");
  const [status, setStatus] = useState<"active" | "vacancy">(member?.status === "vacancy" ? "vacancy" : "active");
  const [roleIds, setRoleIds] = useState<string[]>(member ? memberRoleIds(member, structure) : []);
  const [regions, setRegions] = useState<string[]>(member ? memberRegions(member, structure) : []);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  function toggle(value: string, list: string[], update: (values: string[]) => void) { update(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_person", id: member?.directoryId, fullName: form.get("fullName"), email: member?.email || "", department, responsibilities: form.get("responsibilities"), status, roleIds, regions }) });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) { onSaved(result.data); return; }
    setError(result?.error || "The team member could not be saved.");
    setSaving(false);
  }
  async function remove() {
    if (!member || !window.confirm("Remove " + (member.fullName || member.email) + " from Recharge?")) return;
    setRemoving(true);
    const response = member.directoryId
      ? await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove_person", id: member.directoryId }) })
      : await fetch("/api/access", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: member.email }) });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) member.directoryId ? onSaved(result.data) : window.location.reload();
    else { setError("The team member could not be removed."); setRemoving(false); }
  }
  return (
    <Modal title={member ? "Manage team member" : "Add team member"} subtitle="Set their department, roles, coverage and individual responsibilities." onClose={onClose}>
      <form onSubmit={save}>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
          <Field label="Position status"><select className="field bg-white" value={status} onChange={(event) => setStatus(event.target.value as "active" | "vacancy")}><option value="active">Filled position</option><option value="vacancy">Vacancy</option></select></Field>
          <Field label={status === "vacancy" ? "Vacancy label (optional)" : "Name"}><input className="field" name="fullName" defaultValue={member?.fullName || ""} placeholder={status === "vacancy" ? "e.g. Edinburgh Operations Manager" : "Team member name"} required={status === "active"} /></Field>
          <Field label="Department"><select className="field bg-white" value={department} onChange={(event) => { setDepartment(event.target.value as TeamDepartment); setRoleIds([]); }}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Roles"><div className="grid gap-2 sm:grid-cols-2">{structure.roles.filter((role) => normalizeDepartment(role.department) === department).map((role) => <Choice key={role.id} selected={roleIds.includes(role.id)} onClick={() => toggle(role.id, roleIds, setRoleIds)} label={role.name} />)}{!structure.roles.some((role) => normalizeDepartment(role.department) === department) && <p className="text-sm text-[#718184]">Create a role for this department first.</p>}</div></Field>
          <Field label="Individual Scotland coverage"><div className="grid gap-2 sm:grid-cols-2">{structure.regions.map((region) => <Choice key={region} selected={regions.includes(region)} onClick={() => toggle(region, regions, setRegions)} label={region} />)}</div></Field>
          <Field label="Individual responsibilities"><textarea className="field min-h-28 py-3" name="responsibilities" defaultValue={member?.responsibilities || ""} placeholder="Describe work this person owns beyond their role responsibilities." /></Field>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex flex-col-reverse justify-between gap-3 border-t border-[#e2e9e7] bg-[#f8faf9] px-6 py-4 sm:flex-row">
          {member ? <button type="button" className="h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700" disabled={removing || saving} onClick={remove}>{removing ? "Removing…" : "Remove team member"}</button> : <span />}
          <div className="flex justify-end gap-3"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || removing}>{saving ? "Saving…" : "Save team member"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function RoleEditor({ role, structure, onClose, onSaved }: { role?: TeamCustomRole; structure: TeamStructureData; onClose: () => void; onSaved: (data: TeamStructureData) => void }) {
  const [department, setDepartment] = useState<TeamDepartment>(normalizeDepartment(role?.department || "stays"));
  const [regions, setRegions] = useState<string[]>(role?.regions.length ? role.regions : ["General"]);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  function toggleRegion(value: string) {
    if (value === "General") { setRegions(regions.includes("General") ? [] : ["General"]); return; }
    const withoutGeneral = regions.filter((item) => item !== "General");
    setRegions(withoutGeneral.includes(value) ? withoutGeneral.filter((item) => item !== value) : [...withoutGeneral, value]);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const responsibilities = String(form.get("responsibilities") || "").split("\n").map((item) => item.trim()).filter(Boolean);
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_role", id: role?.id, name: form.get("name"), description: form.get("description"), department, responsibilities, regions: regions.length ? regions : ["General"], parentRoleId: form.get("parentRoleId") }),
    });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) onSaved(result.data);
    else { setError(result?.error || "The role could not be saved."); setSaving(false); }
  }
  async function remove() {
    if (!role || !window.confirm("Remove this role? Team members will remain in their department.")) return;
    setRemoving(true);
    const response = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove_role", id: role.id }) });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) onSaved(result.data);
    else { setError(result?.error || "The role could not be removed."); setRemoving(false); }
  }
  const parents = structure.roles.filter((item) => item.id !== role?.id);
  return (
    <Modal title={role ? "Edit team role" : "Add a team role"} subtitle="Define the role, its responsibilities, reporting line and operating regions." onClose={onClose}>
      <form onSubmit={save}>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-6">
          <Field label="Role name"><input className="field" name="name" defaultValue={role?.name || ""} placeholder="e.g. Owner Relations Manager" required /></Field>
          <Field label="Department"><select className="field bg-white" value={department} onChange={(event) => setDepartment(event.target.value as TeamDepartment)}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Reports to"><select className="field bg-white" name="parentRoleId" defaultValue={role?.parentRoleId || ""}><option value="">Top-level role</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.name} · {roleNames[normalizeDepartment(item.department)]}</option>)}</select></Field>
          <Field label="Role purpose"><textarea className="field min-h-24 py-3" name="description" defaultValue={role?.description || ""} placeholder="A short explanation of why this role exists." /></Field>
          <Field label="Responsibilities — one per line"><textarea className="field min-h-36 py-3" name="responsibilities" defaultValue={role?.responsibilities.join("\n") || ""} placeholder={"Own client onboarding\nApprove weekly owner reports\nEscalate service issues"} /></Field>
          <Field label="Role regions"><p className="mb-3 text-sm text-[#718184]">Choose General for Scotland-wide roles, or select more than one specific region.</p><div className="grid gap-2 sm:grid-cols-2">{structure.regions.map((region) => <Choice key={region} selected={regions.includes(region)} onClick={() => toggleRegion(region)} label={region} />)}</div></Field>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex flex-col-reverse justify-between gap-3 border-t border-[#e2e9e7] bg-[#f8faf9] px-6 py-4 sm:flex-row">
          {role ? <button type="button" className="h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700" disabled={removing || saving} onClick={() => void remove()}>{removing ? "Removing…" : "Remove role"}</button> : <span />}
          <div className="flex justify-end gap-3"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || removing}>{saving ? "Saving…" : "Save role"}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleEditor({ department, members, onClose, onSaved }: { department: TeamDepartment; members: TeamMember[]; onClose: () => void; onSaved: (data: TeamStructureData) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_schedule", department, title: form.get("title"), scheduleDate: form.get("scheduleDate"), startTime: form.get("startTime"), endTime: form.get("endTime"), assignedEmail: form.get("assignedEmail"), note: form.get("note") }),
    });
    const result = await response.json().catch(() => null) as { data: TeamStructureData; error?: string } | null;
    if (response.ok && result) onSaved(result.data);
    else { setError(result?.error || "The schedule item could not be saved."); setSaving(false); }
  }
  const eligible = members.filter((member) => member.role === department && member.status !== "vacancy");
  return (
    <Modal title={"Add to " + roleNames[department]} subtitle="Create a department shift, meeting, inspection or scheduled task." onClose={onClose}>
      <form onSubmit={save}>
        <div className="space-y-5 px-6 py-6">
          <Field label="Schedule title"><input className="field" name="title" placeholder="e.g. Weekly pricing review" required /></Field>
          <div className="grid gap-4 sm:grid-cols-3"><Field label="Date"><input className="field" type="date" name="scheduleDate" required /></Field><Field label="Start"><input className="field" type="time" name="startTime" required /></Field><Field label="End"><input className="field" type="time" name="endTime" required /></Field></div>
          <Field label="Assigned to"><select className="field bg-white" name="assignedEmail"><option value="">Whole department</option>{eligible.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></Field>
          <Field label="Notes"><textarea className="field min-h-24 py-3" name="note" placeholder="Location, links or anything the team needs to know." /></Field>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-[#e2e9e7] bg-[#f8faf9] px-6 py-4"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to schedule"}</button></div>
      </form>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#10271f]/55 p-4 backdrop-blur-sm"><div className="w-full max-w-2xl overflow-hidden rounded-[1.6rem] border border-[#d8e2df] bg-white shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-[#e2e9e7] px-6 py-5"><div><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-1 text-sm text-[#718184]">{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X className="size-5" /></button></div>{children}</div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-semibold">{label}</span>{children}</label>; }
function Choice({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) { return <button type="button" onClick={onClick} className={"flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium " + (selected ? "border-[#315f50] bg-[#e2ebe7]" : "border-[#d7e0dd] bg-white")}><span>{label}</span><span className={"grid size-5 place-items-center rounded-full border " + (selected ? "border-[#315f50] bg-[#315f50] text-white" : "border-[#acbbb6]")} >{selected && <Check className="size-3" />}</span></button>; }
function RegionPill({ area }: { area: string }) { return <span className="inline-flex items-center gap-1 rounded-full border border-[#d7e0dd] bg-white px-2.5 py-1 text-xs text-[#526b65]"><MapPin className="size-3" />{area}</span>; }
function StatusPill({ status }: { status: AccessStatus | "vacancy" }) { const styles = status === "active" ? "bg-emerald-50 text-emerald-700" : status === "vacancy" ? "bg-amber-100 text-amber-800" : status === "pending" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"; return <span className={"rounded-full px-2 py-1 text-[11px] font-semibold " + styles}>{status}</span>; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RS"; }
function normalizeDepartment(value: string): TeamDepartment { return value === "admin" ? "leadership" : (value as TeamDepartment); }
function memberRoleIds(member: TeamMember, structure: TeamStructureData) { return member.roleIds || structure.roles.filter((role) => member.email && role.memberEmails.includes(member.email)).map((role) => role.id); }
function memberRegions(member: TeamMember, structure: TeamStructureData) { return member.regions || structure.coverage.find((item) => member.email && item.email === member.email)?.regions || []; }
function formatRegions(regions: string[]) { return regions.includes("General") ? "General / Scotland-wide" : regions.length ? regions.join(", ") : "No region set"; }
function formatDate(value: string) { const date = new Date(value + "T12:00:00"); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(date); }
