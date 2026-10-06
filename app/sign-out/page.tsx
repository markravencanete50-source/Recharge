export default function SignOut() {
  return <main className="grid min-h-dvh place-items-center p-6"><section className="rounded-3xl border border-border bg-card p-8"><h1 className="text-2xl font-semibold">Sign out of Recharge</h1><form action="/api/session/logout" method="post" className="mt-6"><button className="primary-button">Sign out</button></form></section></main>;
}
