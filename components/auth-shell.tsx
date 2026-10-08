import type { ReactNode } from "react";
import { CompanyLogo } from "./company-logo";

// The frame for every page someone sees before they are signed in: a forest brand panel (the
// same in both themes, so the logo artwork sits flush on its own canvas) beside a bone card.
// On phones the panel becomes a short band above the card.
export function AuthShell({ eyebrow = "Recharge workspace", title, intro, welcome = "Welcome back.", children, footer }: {
  eyebrow?: string; title: string; intro: ReactNode; welcome?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <main className="auth-page">
      <aside className="auth-brand">
        <CompanyLogo width={168} variant="dark" />
        <div className="auth-brand-copy">
          <p className="auth-brand-title">{welcome}</p>
          <p className="auth-brand-text">Your properties, stays, cleans and repairs, together in one place.</p>
        </div>
        <p className="auth-brand-note">Recharge Property Management · Scotland</p>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1 className="auth-title">{title}</h1>
          <div className="auth-intro">{intro}</div>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
