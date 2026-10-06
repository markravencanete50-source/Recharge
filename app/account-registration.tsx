"use client";

import { FormEvent, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Home,
  LockKeyhole,
  ShieldCheck,
  SprayCan,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccessStatus, WorkspaceRole } from "@/lib/modules";

const ROLE_OPTIONS = [
  {
    id: "client",
    label: "Client",
    description: "Your properties, performance and onboarding tools.",
    icon: Building2,
  },
  {
    id: "stays",
    label: "Stays employee",
    description: "Recharge Stays, Cleans and Ready tools.",
    icon: Home,
  },
  {
    id: "cleans",
    label: "Cleans employee",
    description: "Recharge Cleans tools only.",
    icon: SprayCan,
  },
  {
    id: "ready",
    label: "Ready employee",
    description: "Recharge Ready tools only.",
    icon: Wrench,
  },
  {
    id: "admin",
    label: "Admin",
    description: "All tools and account-access controls.",
    icon: ShieldCheck,
  },
] as const satisfies ReadonlyArray<{
  id: WorkspaceRole;
  label: string;
  description: string;
  icon: typeof Home;
}>;

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  client: "Client",
  stays: "Stays employee",
  cleans: "Cleans employee",
  ready: "Ready employee",
  admin: "Admin",
};

export function AccountRegistration({
  email,
  suggestedName,
  signOutPath,
  existingRequest,
}: {
  email: string;
  suggestedName: string;
  signOutPath: string;
  existingRequest?: {
    role: WorkspaceRole;
    status: AccessStatus;
  } | null;
}) {
  const [role, setRole] = useState<WorkspaceRole>("client");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (existingRequest?.status === "pending") {
    return (
      <AccountState
        email={email}
        signOutPath={signOutPath}
        icon={Clock3}
        eyebrow="Approval pending"
        title="Your access request has been sent."
        message={`You requested ${ROLE_LABELS[existingRequest.role]} access. An admin needs to approve the account before you can enter the Recharge workspace.`}
      />
    );
  }

  if (existingRequest?.status === "revoked") {
    return (
      <AccountState
        email={email}
        signOutPath={signOutPath}
        icon={LockKeyhole}
        eyebrow="Account unavailable"
        title="Your Recharge access is currently disabled."
        message="Contact a Recharge admin if you believe your account should be restored."
      />
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/access/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: form.get("fullName"), role }),
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      setError(result?.error || "Your account could not be created.");
      setSaving(false);
      return;
    }
    window.location.reload();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eef3f0] px-5 py-10 text-[#1c3934]">
      <section className="surface grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-[#d8e2df] bg-white shadow-[0_28px_90px_rgba(18,47,51,0.12)] lg:grid-cols-[0.72fr_1.28fr]">
        <div className="forest-panel bg-[#1c3934] p-8 text-white sm:p-11">
          <img src="/recharge-wordmark.svg" alt="Recharge" className="h-auto w-48" />
          <p className="mt-16 text-xs font-semibold uppercase tracking-[0.18em] text-[#8fb3a2]">
            Secure workspace
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">
            One account. The right tools for your role.
          </h1>
          <p className="mt-5 text-base leading-7 text-white/65">
            Every Recharge account has its own access. Employee and admin requests are checked before they are activated.
          </p>
          <div className="mt-10 space-y-3 text-sm text-white/75">
            <p className="flex items-center gap-3"><Check className="size-4 text-[#8fb3a2]" /> Secure ChatGPT sign-in</p>
            <p className="flex items-center gap-3"><Check className="size-4 text-[#8fb3a2]" /> Role-based department access</p>
            <p className="flex items-center gap-3"><Check className="size-4 text-[#8fb3a2]" /> Individual admin controls</p>
          </div>
        </div>

        <form className="p-7 sm:p-10" onSubmit={submit}>
          <div className="grid size-12 place-items-center rounded-2xl bg-[#edf5f0] text-[#315f4d]">
            <LockKeyhole className="size-5" />
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
            Create your Recharge account
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#647577]">
            Your password and sign-in are handled securely by ChatGPT. Recharge stores your profile and access permissions.
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" required defaultValue={suggestedName} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} disabled />
            </div>
          </div>

          <fieldset className="mt-7">
            <legend className="text-sm font-medium">Select your account type</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ROLE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = role === option.id;
                return (
                  <label
                    className={`cursor-pointer rounded-2xl border p-4 transition ${selected ? "border-[#315f4d] bg-[#edf5f0] ring-1 ring-[#315f4d]" : "border-[#dce5e2] hover:border-[#9eb4ad] hover:bg-[#f8faf9]"}`}
                    key={option.id}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="role"
                      value={option.id}
                      checked={selected}
                      onChange={() => setRole(option.id)}
                    />
                    <span className="flex items-start gap-3">
                      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-[#1c3934] text-white" : "bg-[#edf3f1] text-[#4e6a65]"}`}>
                        <Icon className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-[#708083]">{option.description}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {role !== "client" && (
            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              This account type requires admin approval. You’ll see a confirmation screen while your request is reviewed.
            </p>
          )}
          {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <Button disabled={saving} className="mt-7 h-12 w-full rounded-xl bg-[#1c3934] text-white hover:bg-[#10271f]">
            {saving ? "Creating account…" : role === "client" ? "Create account" : "Request access"} <ArrowRight />
          </Button>
          <a href={signOutPath} className="mt-5 block text-center text-sm font-medium text-[#58706c] hover:text-[#1c3934]">
            Sign in with a different email
          </a>
        </form>
      </section>
    </main>
  );
}

function AccountState({
  email,
  signOutPath,
  icon: Icon,
  eyebrow,
  title,
  message,
}: {
  email: string;
  signOutPath: string;
  icon: typeof Clock3;
  eyebrow: string;
  title: string;
  message: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#eef3f0] px-5 py-12 text-[#1c3934]">
      <section className="surface w-full max-w-xl rounded-[2rem] border border-[#d8e2df] bg-white p-8 text-center shadow-[0_28px_90px_rgba(18,47,51,0.12)] sm:p-11">
        <div className="mx-auto w-56 rounded-2xl bg-[#1c3934] px-5 py-3">
          <img src="/recharge-wordmark.svg" alt="Recharge" className="h-auto w-full" />
        </div>
        <div className="mx-auto mt-10 grid size-14 place-items-center rounded-2xl bg-[#edf5f0] text-[#315f4d]">
          <Icon className="size-6" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-[#55756e]">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{title}</h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-[#647577]">{message}</p>
        <p className="mt-6 text-sm font-medium text-[#1c3934]">{email}</p>
        <a href={signOutPath} className="mt-7 inline-flex text-sm font-semibold text-[#45665e] hover:text-[#1c3934]">
          Sign in with a different email
        </a>
      </section>
    </main>
  );
}
