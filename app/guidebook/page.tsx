import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { openGuidebook } from "@/lib/launch-preparation-server";

// The guest guidebook (Launch Preparation, migration 20261029500000): filled in by the technician from the team's template.
// No account is needed: the private link is the key, and the team can replace it. Guests see the guest key box code only.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest guidebook · Recharge", robots: { index: false, follow: false } };

const paragraphs = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

export default async function GuidebookPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const page = await openGuidebook((await searchParams).t);
  if (page.state !== "open") {
    return <AuthShell eyebrow="Recharge Property Management" welcome="Welcome." theme="light"
      title={page.state === "invalid" ? "This link isn’t working" : "We couldn’t open the guidebook"}
      intro={page.state === "invalid" ? "The link may be incomplete or out of date. Please use the latest link from your host." : "Something went wrong on our side. Please try again in a few minutes."}>{null}</AuthShell>;
  }
  return <AuthShell wide eyebrow="Recharge Property Management" welcome="Welcome." theme="light" title={page.propertyName} intro={page.address ?? "Everything you need for your stay."}>
    <div className="legal-body">
      {(page.wifiName || page.guestCode) && <section>
        <h2>The essentials</h2>
        <ul>
          {!!page.guestCode && <li><strong>Key box code:</strong> {page.guestCode}</li>}
          {!!page.wifiName && <li><strong>Wi-Fi network:</strong> {page.wifiName}</li>}
          {!!page.wifiPassword && <li><strong>Wi-Fi password:</strong> {page.wifiPassword}</li>}
        </ul>
      </section>}
      {page.sections.map(s => <section key={s.key}>
        <h2>{s.title}</h2>
        {paragraphs(s.text).map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)}
        {!!s.videoUrl && <p><a href={s.videoUrl} target="_blank" rel="noopener noreferrer">Watch the video</a></p>}
        {s.photos.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.photos.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noopener noreferrer"><img src={x.url} alt={x.name} loading="lazy" style={{ width: "100%", borderRadius: 12, aspectRatio: "4 / 3", objectFit: "cover" }} /></a>)}
        </div>}
      </section>)}
    </div>
  </AuthShell>;
}
