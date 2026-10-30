import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { careersListing, careersListings } from "@/lib/careers-server";
import { RESPONSE_PROMISE } from "@/lib/careers";
import { ApplyForm } from "./apply-form";

// The careers page (Business Plan v2, migration 20261031400000): every job whose application form recruitment published,
// and (?job=) that job's description and application form. No account is needed to apply.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Careers · Recharge", description: "Jobs at Recharge Group: housekeeping, guest relations, property management and more across Scotland." };

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(iso));

export default async function CareersPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const job = (await searchParams).job;
  const shell = (title: string, intro: ReactNode, body?: ReactNode) =>
    <AuthShell eyebrow="Recharge Careers" welcome="Work with us." brandText="Short-term letting, cleaning, maintenance and compliance across Scotland. Join the team that looks after our owners' homes and guests."
      title={title} intro={intro} wide theme="light">{body}</AuthShell>;
  if (job) {
    const listing = await careersListing(job);
    if (listing === null) return shell("We couldn't open this job", "Something went wrong on our side. Please try again in a few minutes.");
    if (listing === "closed") return shell("This job is no longer taking applications", <>Have a look at our <a href="/careers">other jobs</a>.</>);
    return shell(listing.title, <>{listing.area} · {RESPONSE_PROMISE}</>, <>
      <section className="enquiry-section" style={{ marginTop: 18 }}>
        <dl style={{ display: "grid", gap: 10, margin: 0 }}>
          <div><dt style={{ fontSize: "0.8rem", color: "var(--rc-muted)" }}>Hours</dt><dd style={{ margin: 0 }}>{listing.hours || "To be agreed"}</dd></div>
          <div><dt style={{ fontSize: "0.8rem", color: "var(--rc-muted)" }}>Expected earnings</dt><dd style={{ margin: 0 }}>{listing.earnings || "To be agreed"}</dd></div>
          {listing.startBy && <div><dt style={{ fontSize: "0.8rem", color: "var(--rc-muted)" }}>Start by</dt><dd style={{ margin: 0 }}>{date(listing.startBy)}</dd></div>}
        </dl>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{listing.description}</div>
      </section>
      <ApplyForm listing={listing} />
      <p className="enquiry-help" style={{ marginTop: 14 }}><a href="/careers">See all jobs</a></p>
    </>);
  }
  const listings = await careersListings();
  if (listings === null) return shell("Careers", "We couldn't load our jobs just now. Please try again in a few minutes.");
  if (!listings.length) return shell("Careers", "We have no open jobs right now. Please check back soon.");
  return shell("Careers", `${listings.length} open ${listings.length === 1 ? "job" : "jobs"}. Choose one to read more and apply.`,
    <ul style={{ display: "grid", gap: 12, marginTop: 18, padding: 0, listStyle: "none" }}>
      {listings.map(l => <li key={l.id}>
        <a href={`/careers?job=${l.id}`} className="enquiry-section" style={{ display: "grid", gap: 6, textDecoration: "none", color: "inherit" }}>
          <strong style={{ fontSize: "1.05rem" }}>{l.title}</strong>
          <span style={{ color: "var(--rc-muted)", fontSize: "0.9rem" }}>{[l.area, l.hours, l.earnings].filter(Boolean).join(" · ")}</span>
          <span style={{ color: "var(--rc-primary)", fontWeight: 600, fontSize: "0.9rem" }}>Read more and apply</span>
        </a>
      </li>)}
    </ul>);
}
