// "Run today's automatic jobs" in the demo: the database sweeps the backend's schedule runs
// (worker/index.ts, `scheduled`), in the same order. tests/demo-browser.test.mjs checks this list
// still names every sweep the schedule calls. The schedule's delivery batch (email and phone
// notices) runs after these, in engine.mjs. Hostaway's sync and web push are left out: the demo has
// no channel manager or browsers to reach.
export const DEMO_JOBS = [
  { rpc: 'workspace_open_pricing_gaps', label: 'Empty nights to price' },
  { rpc: 'workspace_routine_auto', label: 'Routine visits and their reminders' },
  { rpc: 'workspace_mid_stay_cleans', label: 'Mid-stay cleans' },
  { rpc: 'workspace_ensure_daily_todos', label: "Today's daily and department to-dos" },
  { rpc: 'workspace_clean_form_sweep', label: 'Clean forms not sent' },
  { rpc: 'workspace_direct_booking_sweep', label: 'Direct-booking follow-ups' },
  { rpc: 'workspace_chase_owner_approvals', label: 'Owner approval reminders' },
  { rpc: 'workspace_roll_over_signoffs', label: 'Missed sign-offs to management' },
  { rpc: 'workspace_weekly_report_notices', label: 'Weekly owner report notices' },
  { rpc: 'workspace_privacy_retention', label: 'Privacy clean-up' },
];
