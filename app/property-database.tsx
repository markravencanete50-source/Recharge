"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  HardDrive,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ClickUpImportRecord,
  ManagementProperty,
  PropertyDatabaseData,
  PropertyListingLink,
  PropertyStatus,
} from "@/lib/property-database";

export function PropertyDatabase({
  initialData,
  onBack,
}: {
  initialData: PropertyDatabaseData;
  onBack: () => void;
}) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<"new_enquiry" | "sign_them_up" | "onboarding" | "live" | "archived" | "clients" | "reporting">("live");
  const [propertySearch, setPropertySearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(initialData.properties[0]?.id || "");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const properties = useMemo(() => {
    const query = propertySearch.trim().toLowerCase();
    return data.properties.filter((property) =>
      ((section === "clients" || section === "reporting") || property.status === section) &&
      (regionFilter === "all" || property.region === regionFilter) &&
      (!query ||
        [
          property.propertyName,
          property.propertyAddress,
          property.region,
          property.ownerName,
          property.ownerCompany,
          property.ownerEmail,
          property.sourceStatus,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)),
    );
  }, [data.properties, propertySearch, regionFilter, section]);

  const regions = useMemo(
    () =>
      Array.from(
        new Set(data.properties.map((property) => property.region).filter(Boolean)),
      ).sort(),
    [data.properties],
  );

  const clients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return data.clients;
    return data.clients.filter((client) =>
      [client.companyName, ...client.directorNames, client.ownerEmail, client.ownerPhone, ...client.properties.map((property) => property.propertyName)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [clientSearch, data.clients]);

  const selected = properties.find((property) => property.id === selectedId) || properties[0];

  async function syncHostaway() {
    setSyncing(true);
    setError("");
    const response = await fetch("/api/property-database", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const result = (await response.json().catch(() => null)) as { data?: PropertyDatabaseData; error?: string } | null;
    setSyncing(false);
    if (!response.ok || !result?.data) {
      setError(result?.error || "Hostaway properties could not be synced.");
      return;
    }
    setData(result.data);
    setSelectedId(result.data.properties[0]?.id || "");
  }

  if (!data.available) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="rounded-3xl border border-[#ead8a5] bg-[#fff9e8] p-7 text-[#765e22]">
          The Management Property Database is temporarily unavailable.
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="eyebrow">Recharge Stays</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Management Property Database</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#647577]">
            Property, owner, access, listing and payout information in one searchable record.
          </p>
        </div>
        {data.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={syncing || !data.hostawayConnected} onClick={syncHostaway}>
              {syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {syncing ? "Syncing…" : "Sync Hostaway"}
            </Button>
            <PropertyDialog
              property={null}
              onSaved={(next) => {
                setData(next);
                setSelectedId(next.properties.at(-1)?.id || next.properties[0]?.id || "");
              }}
              onError={setError}
            />
          </div>
        )}
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="New enquiries" value={data.properties.filter((property) => property.status === "new_enquiry").length} icon={Mail} />
        <Stat label="Sign them up" value={data.properties.filter((property) => property.status === "sign_them_up").length} icon={FileText} />
        <Stat label="Onboarding" value={data.properties.filter((property) => property.status === "onboarding").length} icon={ClipboardList} />
        <Stat label="Live" value={data.properties.filter((property) => property.status === "live").length} icon={CheckCircle2} />
        <Stat label="Clients" value={data.clients.length} icon={UsersRound} />
      </section>

      {error && <div className="mt-5 rounded-2xl border border-[#efcaca] bg-[#fff1f1] px-5 py-4 text-sm font-medium text-[#923f3f]">{error}</div>}

      <Tabs value={section} onValueChange={(value) => setSection(value as typeof section)} className="mt-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-[#e3ebe7] p-1.5 sm:grid-cols-3 xl:grid-cols-7">
          <TabsTrigger value="new_enquiry" className="h-11 min-h-11 rounded-xl px-3">New enquiry</TabsTrigger>
          <TabsTrigger value="sign_them_up" className="h-11 min-h-11 rounded-xl px-3">Sign them up</TabsTrigger>
          <TabsTrigger value="live" className="h-11 min-h-11 rounded-xl px-3">Live properties</TabsTrigger>
          <TabsTrigger value="onboarding" className="h-11 min-h-11 rounded-xl px-3">Onboarding</TabsTrigger>
          <TabsTrigger value="archived" className="h-11 min-h-11 rounded-xl px-3">Archived</TabsTrigger>
          <TabsTrigger value="clients" className="h-11 min-h-11 rounded-xl px-3">Client portfolios</TabsTrigger>
          <TabsTrigger value="reporting" className="h-11 min-h-11 rounded-xl px-3">Reporting</TabsTrigger>
        </TabsList>
      </Tabs>

      {section === "reporting" ? (
        <PropertyReporting data={data} />
      ) : section !== "clients" ? (
        <section className="surface mt-5 grid overflow-hidden rounded-[1.6rem] border border-[#d5dfdc] bg-white xl:h-[42rem] xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="border-b border-[#dfe7e4] bg-[#f7f9f8] xl:border-r xl:border-b-0">
            <SearchBox value={propertySearch} onChange={setPropertySearch} placeholder="Search property, address or owner" />
            <div className="border-b border-[#dfe7e4] px-4 pb-4">
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Region" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All regions</SelectItem>{regions.map((region) => <SelectItem key={region} value={region}>{region}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="max-h-96 overflow-y-auto xl:max-h-[36rem]">
              {properties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => setSelectedId(property.id)}
                  className={`w-full border-b border-[#e3e9e7] px-5 py-4 text-left transition ${selected?.id === property.id ? "bg-white" : "hover:bg-white/70"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{property.propertyName}</p>
                    <StatusBadge status={property.status} />
                  </div>
                  <p className="mt-2 truncate text-xs text-[#718184]">{property.propertyAddress || property.ownerName || "Property details required"}</p>
                </button>
              ))}
              {properties.length === 0 && <p className="px-5 py-10 text-center text-sm text-[#718184]">No matching properties.</p>}
            </div>
          </aside>
          {selected ? (
            <PropertyDetail
              property={selected}
              canEdit={data.canEdit}
              onSaved={(next) => setData(next)}
              onError={setError}
            />
          ) : (
            <div className="grid min-h-80 place-items-center p-8 text-sm text-[#718184]">Select a property to view its record.</div>
          )}
        </section>
      ) : (
        <section className="surface mt-5 rounded-[1.6rem] border border-[#d5dfdc] bg-white p-5 sm:p-6">
          <div className="max-w-xl"><SearchBox value={clientSearch} onChange={setClientSearch} placeholder="Search clients or portfolio properties" /></div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {clients.map((client) => (
              <article key={client.key} className="rounded-2xl border border-[#dfe7e4] bg-[#fbfcfb] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold">{client.companyName || client.ownerName}</p>
                    {client.directorNames.length > 0 && <p className="mt-1 text-sm text-[#647577]">Directors: {client.directorNames.join(", ")}</p>}
                    <div className="mt-2 space-y-1 text-sm text-[#647577]">
                      {client.ownerEmail && <p className="flex items-center gap-2"><Mail className="size-4" /> {client.ownerEmail}</p>}
                      {client.ownerPhone && <p className="flex items-center gap-2"><Phone className="size-4" /> {client.ownerPhone}</p>}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-[#cddbd6] bg-white">{client.properties.length} {client.properties.length === 1 ? "property" : "properties"}</Badge>
                </div>
                <div className="mt-5 space-y-2">
                  {client.properties.map((property) => (
                    <div key={property.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3">
                      <span className="truncate text-sm font-medium">{property.propertyName}</span>
                      <StatusBadge status={property.status} />
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {clients.length === 0 && <p className="py-12 text-center text-sm text-[#718184] xl:col-span-2">No matching clients.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function PropertyReporting({ data }: { data: PropertyDatabaseData }) {
  const portfolios = data.clients.filter((client) => client.key !== "unassigned");
  const portfolioProperties = portfolios.reduce((total, client) => total + client.properties.length, 0);
  const averagePortfolio = portfolios.length ? portfolioProperties / portfolios.length : 0;
  const periods = [
    ["This week", data.reporting.newEnquiries.week],
    ["This month", data.reporting.newEnquiries.month],
    ["This quarter", data.reporting.newEnquiries.quarter],
    ["This year", data.reporting.newEnquiries.year],
  ] as const;
  return (
    <section className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {periods.map(([label, value]) => <article key={label} className="surface rounded-2xl border border-[#d9e2df] bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-[#647577]">New enquiries</p><CalendarDays className="size-4 text-[#527261]" /></div><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-[#718184]">{label}</p></article>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="forest-panel rounded-2xl bg-[#1c3934] p-6 text-white"><TrendingUp className="size-5 text-[#8fb3a2]" /><p className="mt-6 text-4xl font-semibold tracking-[-0.04em]">{data.reporting.strikeRate}%</p><p className="mt-2 font-medium">Enquiry-to-onboarding strike rate</p><p className="mt-2 text-sm leading-6 text-white/60">The percentage of recorded enquiries that progressed into onboarding.</p></article>
        <article className="surface rounded-2xl border border-[#d9e2df] bg-white p-6"><UsersRound className="size-5 text-[#527261]" /><p className="mt-6 text-4xl font-semibold tracking-[-0.04em]">{portfolios.length}</p><p className="mt-2 font-medium">Clients</p><p className="mt-2 text-sm leading-6 text-[#718184]">Landlords or companies with a named portfolio, excluding archived properties.</p></article>
        <article className="surface rounded-2xl border border-[#d9e2df] bg-white p-6"><Building2 className="size-5 text-[#527261]" /><p className="mt-6 text-4xl font-semibold tracking-[-0.04em]">{averagePortfolio.toFixed(1)}</p><p className="mt-2 font-medium">Average portfolio size</p><p className="mt-2 text-sm leading-6 text-[#718184]">Average active properties managed per landlord or company.</p></article>
      </div>
      <article className="surface overflow-hidden rounded-[1.6rem] border border-[#d5dfdc] bg-white">
        <div className="flex items-center gap-3 border-b border-[#dfe7e4] px-5 py-5 sm:px-6"><BarChart3 className="size-5 text-[#527261]" /><div><h2 className="font-semibold">Properties signed up</h2><p className="mt-1 text-sm text-[#718184]">Recorded when the management agreement was signed.</p></div></div>
        <div className="divide-y divide-[#e3e9e7]">
          {data.reporting.signedUp.map((item) => <div key={`${item.propertyName}:${item.signedAt}`} className="flex flex-col justify-between gap-1 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><p className="font-medium text-[#27443f]">{item.propertyName}</p><p className="text-sm text-[#718184]">{formatDate(item.signedAt)}</p></div>)}
          {!data.reporting.signedUp.length && <p className="px-6 py-10 text-center text-sm text-[#718184]">No signed management agreements have been recorded yet.</p>}
        </div>
      </article>
    </section>
  );
}

function PropertyDetail({
  property,
  canEdit,
  onSaved,
  onError,
}: {
  property: ManagementProperty;
  canEdit: boolean;
  onSaved: (data: PropertyDatabaseData) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto bg-[#fbfcfb] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={property.status} />
            {property.hostawayListingId && <Badge className="border-0 bg-[#e7f4f3] text-[#2f6e73]">Hostaway linked</Badge>}
            {property.clickupTaskId && <Badge className="border-0 bg-[#eef0ff] text-[#565fa0]">ClickUp imported</Badge>}
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{property.propertyName}</h2>
          <p className="mt-2 flex items-start gap-2 text-sm text-[#718184]"><MapPin className="mt-0.5 size-4 shrink-0" />{property.propertyAddress || "Address still required"}</p>
        </div>
        {canEdit && <PropertyDialog key={property.id} property={property} onSaved={onSaved} onError={onError} />}
      </div>

      <Tabs defaultValue="record" className="mt-6">
        <TabsList className="h-auto rounded-2xl bg-[#e3ebe7] p-1.5">
          <TabsTrigger value="record" className="min-h-10 rounded-xl px-4">Property record</TabsTrigger>
          {property.clickupTaskId && <TabsTrigger value="history" className="min-h-10 rounded-xl px-4">Imported history</TabsTrigger>}
        </TabsList>
        <TabsContent value="record" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <InfoCard title="Property" icon={Building2}>
              <InfoLine label="Address" value={property.propertyAddress} multiline />
              <InfoLine label="Region" value={property.region} />
              <InfoLine label="Type" value={property.propertyType} />
              <InfoLine label="Bedrooms" value={property.bedrooms} />
              <InfoLine label="Beds" value={property.beds} />
              <InfoLine label="Bathrooms" value={property.bathrooms} />
              <InfoLine label="Separate WCs" value={property.wcCount} />
              <InfoLine label="Parking" value={property.parking} multiline />
              <InfoLine label="Garden" value={property.garden} multiline />
            </InfoCard>
            <InfoCard title="Client" icon={UserRound}>
              <InfoLine label="Business name" value={property.ownerCompany} />
              <InfoLine label="Director name" value={property.ownerName} />
              <InfoLine label="Email" value={property.ownerEmail} />
              <InfoLine label="Phone" value={property.ownerPhone} />
              <InfoLine label="Correspondence address" value={property.correspondenceAddress} multiline />
              <InfoLine label="Existing client" value={property.existingClient} />
            </InfoCard>
            <InfoCard title="Access" icon={KeyRound}>
              <InfoLine label="Code" value={property.accessCode} />
              <InfoLine label="Access information" value={property.accessInfo} multiline />
            </InfoCard>
            <InfoCard title="Enquiry & onboarding" icon={ClipboardList}>
              <InfoLine label="Original board stage" value={property.sourceStatus} />
              <InfoLine label="Operating now" value={property.currentlyOperating} />
              <InfoLine label="Furnishing" value={property.furnishingPreference} multiline />
              <InfoLine label="Licensing" value={property.licensingPreference} multiline />
              <InfoLine label="Preferred start" value={property.startPreference} multiline />
              <InfoLine label="Enquiry reason" value={property.enquiryReason} multiline />
              <InfoLine label="Additional notes" value={property.additionalNotes} multiline />
            </InfoCard>
            <InfoCard title="Guest information" icon={Link2}>
              <InfoLink label="Guidebook" url={property.guidebookUrl} />
              {property.listingLinks.map((link) => <InfoLink key={`${link.label}:${link.url}`} label={link.label} url={link.url} />)}
              {!property.guidebookUrl && property.listingLinks.length === 0 && <EmptyValue />}
            </InfoCard>
            <InfoCard title="Payout" icon={WalletCards}>
              <InfoLine label="Payout date" value={property.payoutSchedule} />
              <InfoLine label="Management fee" value={property.managementFeePercent ? `${property.managementFeePercent}%` : ""} />
              <InfoLine label="Cleaning cost per changeover" value={property.cleaningCostPence ? `£${(property.cleaningCostPence / 100).toFixed(2)}` : ""} />
              <InfoLine label="Notes" value={property.payoutNotes} multiline />
            </InfoCard>
          </div>
        </TabsContent>
        {property.clickupTaskId && (
          <TabsContent value="history" className="mt-4">
            <ClickUpArchive property={property} />
          </TabsContent>
        )}
      </Tabs>
      <p className="mt-5 text-xs text-[#7a888a]">Recharge record updated {formatDate(property.updatedAt)}</p>
    </div>
  );
}

function ClickUpArchive({ property }: { property: ManagementProperty }) {
  const records = property.sourceRecords.length ? property.sourceRecords : [legacySourceRecord(property)];
  const checklistItems = records.flatMap((record) => record.checklists.flatMap((checklist) => checklist.items.flatMap((item) => [item, ...item.children])));
  const completedItems = checklistItems.filter((item) => item.resolved).length;
  const commentTotal = records.reduce((total, record) => total + record.comments.reduce((count, comment) => count + 1 + comment.replies.length, 0), 0);
  const attachments = records.flatMap((record) => record.attachments);
  const fileBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <ArchiveStat icon={Archive} label="Original cards" value={String(records.length)} />
        <ArchiveStat icon={ClipboardList} label="Checklist items" value={`${completedItems}/${checklistItems.length}`} />
        <ArchiveStat icon={MessageSquare} label="Comments & replies" value={String(commentTotal)} />
        <ArchiveStat icon={Paperclip} label="Attachment index" value={`${attachments.length} · ${formatBytes(fileBytes)}`} />
      </div>
      <p className="rounded-2xl border border-[#d9e2df] bg-white px-5 py-4 text-sm leading-6 text-[#647577]">
        Every original Property Info card linked to this property is preserved below. Open a card to view its description, custom fields, checklist progress, comments, replies and file index.
      </p>
      <div className="space-y-3">
        {records.map((record) => <ClickUpSourceCard key={record.clickupTaskId} record={record} />)}
      </div>
    </div>
  );
}

function ClickUpSourceCard({ record }: { record: ClickUpImportRecord }) {
  const checklistItems = record.checklists.flatMap((checklist) => checklist.items.flatMap((item) => [item, ...item.children]));
  const completedItems = checklistItems.filter((item) => item.resolved).length;
  const comments = record.comments.reduce((total, comment) => total + 1 + comment.replies.length, 0);
  const fileBytes = record.attachments.reduce((total, attachment) => total + attachment.size, 0);
  const description = record.descriptionMarkdown || record.textContent;
  return (
    <details className="overflow-hidden rounded-2xl border border-[#d9e2df] bg-white">
      <summary className="cursor-pointer list-none px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-semibold">{record.propertyName}</p><p className="mt-1 text-xs text-[#718184]">{record.clickupStatus} · Updated {formatClickUpDate(record.updatedAt)}</p></div>
          <div className="flex flex-wrap gap-2 text-xs text-[#647577]"><Badge variant="outline">{completedItems}/{checklistItems.length} tasks</Badge><Badge variant="outline">{comments} comments</Badge><Badge variant="outline">{record.attachments.length} files</Badge></div>
        </div>
      </summary>
      <div className="border-t border-[#e2e9e7] bg-[#f7f9f8] p-5">
        <div className="grid gap-4 xl:grid-cols-2">
          <InfoCard title="Source record" icon={Archive}>
            <InfoLine label="ClickUp task ID" value={record.clickupTaskId} />
            <InfoLine label="Board stage" value={record.clickupStatus} />
            <InfoLine label="Priority" value={record.priority} />
            <InfoLine label="Due date" value={formatClickUpDate(record.dueAt)} />
            <InfoLine label="Created" value={formatClickUpDate(record.createdAt)} />
            <InfoLine label="Last updated" value={formatClickUpDate(record.updatedAt)} />
            <a href={record.clickupUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#2f6e73]">Open original card <ExternalLink className="size-4" /></a>
          </InfoCard>
          <InfoCard title="Original description" icon={FileText}>
            {description ? <p className="whitespace-pre-wrap text-sm leading-6 text-[#536467]">{description}</p> : <EmptyValue />}
          </InfoCard>
        </div>
        {Object.keys(record.customFields).length > 0 && (
          <ArchiveSection title="Custom fields" icon={Building2}>
            <div className="grid gap-4 sm:grid-cols-2">{Object.entries(record.customFields).map(([label, value]) => <InfoLine key={label} label={label} value={value} multiline />)}</div>
          </ArchiveSection>
        )}
        {record.checklists.length > 0 && (
          <ArchiveSection title="Checklists" icon={ClipboardList}>
            <div className="space-y-3">{record.checklists.map((checklist) => <div key={checklist.id} className="rounded-xl border border-[#dfe7e4] bg-white p-4"><p className="text-sm font-semibold">{checklist.name} <span className="font-normal text-[#718184]">· {checklist.resolved} complete, {checklist.unresolved} remaining</span></p><div className="mt-3 space-y-2">{checklist.items.flatMap((item) => [item, ...item.children]).map((item) => <p key={item.id} className="flex items-start gap-2 text-sm text-[#536467]"><span className={`mt-1 size-3 shrink-0 rounded-full ${item.resolved ? "bg-[#63d48b]" : "border border-[#aebdb9] bg-white"}`} />{item.name}</p>)}</div></div>)}</div>
          </ArchiveSection>
        )}
        {record.comments.length > 0 && (
          <ArchiveSection title="Comments & replies" icon={MessageSquare}>
            <div className="space-y-3">{record.comments.map((comment) => <article key={comment.id} className="rounded-xl border border-[#dfe7e4] bg-white p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-[#718184]"><span className="font-semibold text-[#536467]">{comment.author || "ClickUp user"}</span><span>{formatClickUpDate(comment.date)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#536467]">{comment.text}</p>{comment.replies.map((reply) => <div key={reply.id} className="ml-4 mt-3 border-l-2 border-[#dce7e1] pl-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-[#718184]"><span className="font-semibold text-[#536467]">{reply.author || "ClickUp user"}</span><span>{formatClickUpDate(reply.date)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#536467]">{reply.text}</p></div>)}</article>)}</div>
          </ArchiveSection>
        )}
        {record.attachments.length > 0 && (
          <ArchiveSection title="Attachment index" icon={HardDrive}>
            <p className="mb-3 text-sm leading-6 text-[#647577]">Names, types and sizes are preserved here. Original file contents remain in ClickUp until the separate {formatBytes(fileBytes)} file-copy stage is complete.</p>
            <div className="grid gap-2 sm:grid-cols-2">{record.attachments.map((attachment) => <div key={attachment.id} className="rounded-xl border border-[#dfe7e4] bg-white px-4 py-3"><p className="truncate text-sm font-semibold" title={attachment.title}>{attachment.title}</p><p className="mt-1 text-xs text-[#718184]">{attachment.extension.toUpperCase() || attachment.mimetype || "File"} · {formatBytes(attachment.size)}</p></div>)}</div>
          </ArchiveSection>
        )}
      </div>
    </details>
  );
}

function legacySourceRecord(property: ManagementProperty): ClickUpImportRecord {
  return {
    clickupTaskId: property.clickupTaskId || "",
    clickupUrl: property.clickupUrl,
    clickupStatus: property.sourceStatus,
    status: property.status,
    region: property.region,
    propertyName: property.propertyName,
    propertyAddress: property.propertyAddress,
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    wcCount: property.wcCount,
    parking: property.parking,
    garden: property.garden,
    ownerName: property.ownerName,
    ownerCompany: property.ownerCompany,
    ownerEmail: property.ownerEmail,
    ownerPhone: property.ownerPhone,
    correspondenceAddress: property.correspondenceAddress,
    existingClient: property.existingClient,
    currentlyOperating: property.currentlyOperating,
    furnishingPreference: property.furnishingPreference,
    licensingPreference: property.licensingPreference,
    startPreference: property.startPreference,
    enquiryReason: property.enquiryReason,
    additionalNotes: property.additionalNotes,
    descriptionMarkdown: property.sourceDescription,
    textContent: "",
    priority: property.sourcePriority,
    dueAt: property.sourceDueAt,
    createdAt: property.sourceCreatedAt,
    updatedAt: property.sourceUpdatedAt,
    customFields: property.sourceCustomFields,
    checklists: property.sourceChecklists,
    comments: property.sourceComments,
    attachments: property.sourceAttachments,
    linkedTaskIds: property.sourceLinkedTaskIds,
  };
}

function ArchiveSection({ title, icon: Icon, children }: { title: string; icon: typeof Archive; children: React.ReactNode }) {
  return <section className="mt-4 rounded-2xl border border-[#dfe7e4] bg-[#f2f6f4] p-5"><h3 className="mb-4 flex items-center gap-2 text-base font-semibold"><Icon className="size-4 text-[#52706a]" />{title}</h3>{children}</section>;
}

function ArchiveStat({ icon: Icon, label, value }: { icon: typeof Archive; label: string; value: string }) {
  return <div className="surface rounded-2xl border border-[#dfe7e4] bg-white p-4"><Icon className="size-4 text-[#52706a]" /><p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p><p className="mt-1 text-xs text-[#718184]">{label}</p></div>;
}

function PropertyDialog({
  property,
  onSaved,
  onError,
}: {
  property: ManagementProperty | null;
  onSaved: (data: PropertyDatabaseData) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PropertyStatus>(property?.status || "live");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/property-database", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        id: property?.id,
        propertyName: form.get("propertyName"),
        propertyAddress: form.get("propertyAddress"),
        region: form.get("region"),
        propertyType: form.get("propertyType"),
        bedrooms: form.get("bedrooms"),
        beds: form.get("beds"),
        bathrooms: form.get("bathrooms"),
        wcCount: form.get("wcCount"),
        parking: form.get("parking"),
        garden: form.get("garden"),
        ownerName: form.get("ownerName"),
        ownerCompany: form.get("ownerCompany"),
        ownerEmail: form.get("ownerEmail"),
        ownerPhone: form.get("ownerPhone"),
        correspondenceAddress: form.get("correspondenceAddress"),
        accessCode: form.get("accessCode"),
        accessInfo: form.get("accessInfo"),
        guidebookUrl: form.get("guidebookUrl"),
        listingLinks: parseLinkText(String(form.get("listingLinks") || "")),
        payoutSchedule: form.get("payoutSchedule"),
        managementFeePercent: Number(form.get("managementFeePercent") || 0),
        cleaningCostPence: Math.round(Number(form.get("cleaningCost") || 0) * 100),
        payoutNotes: form.get("payoutNotes"),
        status,
      }),
    });
    const result = (await response.json().catch(() => null)) as { data?: PropertyDatabaseData; error?: string } | null;
    setSaving(false);
    if (!response.ok || !result?.data) {
      onError(result?.error || "The property could not be saved.");
      return;
    }
    onSaved(result.data);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={property ? "outline" : "default"} className={property ? "" : "bg-[#1c3934] text-white hover:bg-[#10271f]"}>
          {property ? <Pencil /> : <Plus />} {property ? "Edit property" : "Add property"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-3xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">{property ? "Edit property record" : "Add property record"}</DialogTitle>
            <DialogDescription>Hostaway data remains linked; information completed here is kept during future syncs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Property name"><Input name="propertyName" required defaultValue={property?.propertyName || ""} /></Field>
              <Field label="Status">
                <Select value={status} onValueChange={(value) => setStatus(value as PropertyStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="new_enquiry">New enquiry</SelectItem><SelectItem value="sign_them_up">Sign them up</SelectItem><SelectItem value="onboarding">Onboarding</SelectItem><SelectItem value="live">Live</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Property address"><Textarea name="propertyAddress" rows={2} defaultValue={property?.propertyAddress || ""} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Region"><Input name="region" defaultValue={property?.region || ""} /></Field><Field label="Property type"><Input name="propertyType" defaultValue={property?.propertyType || ""} /></Field></div>
            <div className="grid gap-4 sm:grid-cols-4"><Field label="Bedrooms"><Input name="bedrooms" defaultValue={property?.bedrooms || ""} /></Field><Field label="Beds"><Input name="beds" defaultValue={property?.beds || ""} /></Field><Field label="Bathrooms"><Input name="bathrooms" defaultValue={property?.bathrooms || ""} /></Field><Field label="Separate WCs"><Input name="wcCount" defaultValue={property?.wcCount || ""} /></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Parking"><Input name="parking" defaultValue={property?.parking || ""} /></Field><Field label="Garden"><Input name="garden" defaultValue={property?.garden || ""} /></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Director name"><Input name="ownerName" defaultValue={property?.ownerName || ""} /></Field><Field label="Business name"><Input name="ownerCompany" defaultValue={property?.ownerCompany || ""} /></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Owner email"><Input name="ownerEmail" type="email" defaultValue={property?.ownerEmail || ""} /></Field><Field label="Owner phone"><Input name="ownerPhone" type="tel" defaultValue={property?.ownerPhone || ""} /></Field></div>
            <Field label="Correspondence address"><Textarea name="correspondenceAddress" rows={2} defaultValue={property?.correspondenceAddress || ""} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Access code"><Input name="accessCode" defaultValue={property?.accessCode || ""} /></Field><Field label="Guidebook URL"><Input name="guidebookUrl" type="url" defaultValue={property?.guidebookUrl || ""} /></Field></div>
            <Field label="Access information"><Textarea name="accessInfo" rows={3} defaultValue={property?.accessInfo || ""} placeholder="Keybox location, entry route, alarm or parking access." /></Field>
            <Field label="Listing links"><Textarea name="listingLinks" rows={4} defaultValue={linksToText(property?.listingLinks || [])} placeholder={"Airbnb | https://…\nBooking.com | https://…\nDirect | https://…"} /></Field>
            <div className="grid gap-4 sm:grid-cols-3"><Field label="Payout date"><Input name="payoutSchedule" defaultValue={property?.payoutSchedule || ""} placeholder="For example: 10th of each month" /></Field><Field label="Management fee (%)"><Input name="managementFeePercent" type="number" min="0" max="100" step="0.01" defaultValue={property?.managementFeePercent || 0} /></Field><Field label="Cleaning cost per changeover (£)"><Input name="cleaningCost" type="number" min="0" step="0.01" defaultValue={((property?.cleaningCostPence || 0) / 100).toFixed(2)} /></Field></div>
            <Field label="Payout information"><Textarea name="payoutNotes" rows={4} defaultValue={property?.payoutNotes || ""} placeholder="Payout arrangement, deductions and owner-specific notes." /></Field>
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} className="bg-[#1c3934] text-white">{saving ? "Saving…" : "Save property"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative p-4"><Search className="absolute left-7 top-1/2 size-4 -translate-y-1/2 text-[#819093]" /><Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-white pl-9" placeholder={placeholder} /></div>;
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Building2 }) {
  return <article className="surface rounded-2xl border border-[#d9e2df] bg-white p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-[#647577]">{label}</p><Icon className="size-4 text-[#527261]" /></div><p className="mt-4 text-3xl font-semibold">{value}</p></article>;
}

function InfoCard({ title, icon: Icon, children }: { title: string; icon: typeof Building2; children: React.ReactNode }) {
  return <section className="surface rounded-2xl border border-[#dfe7e4] bg-white p-5"><div className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-[#527261]" /> {title}</div><div className="mt-4 space-y-3">{children}</div></section>;
}

function InfoLine({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#819093]">{label}</p>{value ? <p className={`mt-1 text-sm leading-6 text-[#40585b] ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</p> : <EmptyValue />}</div>;
}

function InfoLink({ label, url }: { label: string; url: string }) {
  if (!url) return null;
  return <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f8f6] px-3 py-2.5 text-sm font-medium hover:bg-[#edf3ef]"><span className="truncate">{label}</span><ExternalLink className="size-4 shrink-0" /></a>;
}

function EmptyValue() { return <p className="mt-1 text-sm text-[#9aa6a7]">Not recorded</p>; }

function StatusBadge({ status }: { status: PropertyStatus }) {
  const tone = status === "live" ? "bg-[#e8f7d6] text-[#36561d]" : ["new_enquiry", "sign_them_up", "onboarding"].includes(status) ? "bg-[#fff1ce] text-[#8a641c]" : "bg-[#edf2f0] text-[#61706d]";
  const label = status === "new_enquiry" ? "New enquiry" : status === "sign_them_up" ? "Sign them up" : status[0].toUpperCase() + status.slice(1);
  return <Badge className={`border-0 ${tone}`}>{label}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }

function BackButton({ onBack }: { onBack: () => void }) { return <button type="button" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#4f6966] hover:text-[#1c3934]" onClick={onBack}><ArrowLeft className="size-4" /> Back to Stays</button>; }

function parseLinkText(value: string): PropertyListingLink[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const [first, ...rest] = line.split("|");
    const maybeUrl = rest.join("|").trim();
    const label = maybeUrl ? first.trim() : "Listing";
    const url = maybeUrl || first.trim();
    return /^https?:\/\//i.test(url) ? [{ label: label || "Listing", url }] : [];
  });
}

function linksToText(links: PropertyListingLink[]) { return links.map((link) => `${link.label} | ${link.url}`).join("\n"); }

function formatDate(timestamp: number) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000)); }

function formatClickUpDate(value: string) {
  if (!value) return "";
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
