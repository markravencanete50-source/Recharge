import type { ReactNode } from "react";
import { AuthScene } from "./auth-scene";
import { CompanyLogo } from "./company-logo";

// The frame for every page someone sees before they are signed in: a forest brand panel (the
// same in both themes, so the logo artwork sits flush on its own canvas) beside a bone card.
// On phones the panel becomes a short band above the card. Pages that ask someone to go ahead
// (sign in, choose a password) show the consent line; the policy pages use a wider card. `theme="light"` keeps a page
// light whatever the browser or the app is set to (the enquiry form, for Alex).
export function AuthShell({ eyebrow = "Recharge workspace", title, intro, welcome = "Welcome back.", brandText = "Your properties, stays, cleans and repairs, together in one place.", children, footer, consent = false, wide = false, theme }: {
  eyebrow?: string; title: string; intro: ReactNode; welcome?: string; brandText?: string; children: ReactNode; footer?: ReactNode; consent?: boolean; wide?: boolean; theme?: "light";
}) {
  return (
    <main className="auth-page" data-recharge-theme={theme}>
      <aside className="auth-brand">
        <CompanyLogo width={168} variant="dark" />
        <div className="auth-brand-copy">
          <p className="auth-brand-title">{welcome}</p>
          <p className="auth-brand-text">{brandText}</p>
        </div>
        <AuthScene />
        <p className="auth-brand-note">Recharge Property Management · Scotland</p>
      </aside>
      <section className="auth-main">
        <div className={wide ? "auth-card legal-card" : "auth-card"}>
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1 className="auth-title">{title}</h1>
          <div className="auth-intro">{intro}</div>
          {children}
          {consent && <p className="auth-consent">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.</p>}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
