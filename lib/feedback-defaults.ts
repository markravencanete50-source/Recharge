import { ONBOARDING_PHASES } from './workspace-view';

// The assumptions behind the October 2026 client-feedback build. The client has not yet confirmed
// them, so each one lives in exactly one place here and in exactly one immutable SQL function, and
// changing one is a one-line change in each. If a constant here and its SQL function disagree, the
// database wins: the screens only use these to explain and pre-check what the database will enforce.
// Only workspace_reflection_required(role) and workspace_visit_form_required() are fixed names in the
// migration outlines; the other SQL names below are the expected ones, and a migration author may pick
// another name as long as this comment is updated to match.

// --- A7: end-of-day reflection (migration 20261012150000_day_reflection) ---------------------------
// SQL: private.workspace_reflection_required(role). Cleaners and admins are not asked.
export const REFLECTION_REQUIRED_ROLES = ['stays', 'ready', 'accounts', 'cleaning_manager'] as const;
export const reflectionRequired = (role: string | null | undefined): boolean => (REFLECTION_REQUIRED_ROLES as readonly string[]).includes(role ?? '');
// A reflection counts once "went well" or "not so well" holds this many characters (matches the saveReflection schema).
export const REFLECTION_MIN_CHARS = 3;
// Admins read reflections up to this many days at a time (read section 'reflections').
export const REFLECTIONS_WINDOW_DAYS = 31;

// --- B2: clean forms (migrations 20261012170000_clean_form_warnings, 20261014100000_clean_form_reminders) ---
// SQL: private.workspace_clean_form_due_time(), private.workspace_clean_form_escalate_time() and
// private.workspace_clean_form_zone(). Client answer 8: after this time on its day (UK time) a clean with no form
// is Unsubmitted and its cleaner is reminded; from CLEAN_FORM_ESCALATE_AT the next day it is a Warning and goes to
// management.
export const CLEAN_FORM_DUE_BY = '18:00';
export const CLEAN_FORM_ESCALATE_AT = '09:00';
export const CLEAN_FORM_ZONE = 'Europe/London';
// A missing form tags the clean (data.warning) and raises a management flag. It never changes what a cleaner is
// paid and the cleaner can still submit late, but their invoice for the clean cannot be approved until the form is in.
export const CLEAN_FORM_WARNING = 'no_form';
export const CLEAN_FORM_WARNING_EFFECT = { tag: true, flagManagement: true, payEffect: 'none', lateSubmitAllowed: true, remindCleaner: true, invoiceApprovalNeedsForm: true } as const;
export const CLEAN_FORM_SWEEP_LIMIT = 200;
// Session A: mid-stay cleans (client answer 5, "Forget this for now"). SQL: private.workspace_mid_stay_cleans_enabled()
// (migration 20261014110000_mid_stay_switch). OFF: the run creates none and leaves existing ones exactly as they are.
export const MID_STAY_CLEANS_ENABLED = false;

// --- B3: direct-booking follow-ups (migration 20261012180000_direct_booking_followups) -------------
// The minimum number of nights is NOT mirrored here: it is the booking policy's minimum_nights
// (default 7) that Stays already edits, so the sweep and the offers always agree.
// SQL: private.workspace_direct_booking_channels(). Only stays that came through a booking site get a
// follow-up; owner stays use channel 'other' and stays entered by hand are never touched.
export const DIRECT_BOOKING_OTA_CHANNELS = ['airbnb', 'booking_com', 'vrbo'] as const;
export const DIRECT_BOOKING_SWEEP_LIMIT = 50;
// The kind of work item the sweep creates (one per reservation).
export const DIRECT_BOOKING_ITEM_KIND = 'direct_booking';

// --- B4: AirCover (migration 20261012190000_aircover_links) ----------------------------------------
// SQL: private.workspace_aircover_work_kinds(). A claim can be linked to these kinds of work only,
// and there is one live claim per work item.
export const AIRCOVER_WORK_KINDS = ['maintenance', 'routine_visit'] as const;

// --- B5 and B6: repairs and visit forms (migration 20261012200000_repairs_visit_forms) -------------
// SQL: private.workspace_repair_estimate_optional(). A repair can be reported with no estimate; it
// then waits in triage ("cost not known yet"). Ready's quote goes to the owner before booking.
export const REPAIR_ESTIMATE_OPTIONAL = true;
export const READY_QUOTE_NEEDS_OWNER = true;
// SQL: resolveRepair branch. Who may close a repair as "resolved by troubleshooting", the only phase
// it is allowed in, and how long the written resolution must be.
export const RESOLVE_REPAIR_ROLES = ['stays', 'admin', 'super_admin'] as const;
export const RESOLVE_REPAIR_PHASE = 'triage';
export const RESOLVE_REPAIR_MIN_CHARS = 5;
export const RESOLVE_REPAIR_MAX_CHARS = 2000;
// SQL: private.workspace_visit_form_required(). A routine visit cannot go to review or complete
// without its form: the plan's checklist, each item done or not done, plus a note.
export const VISIT_FORM_REQUIRED = true;

// --- A9: team calendar (migration 20261012210000_team_calendar) ------------------------------------
// SQL: private.workspace_guest_name_visible(role). Only these roles see a guest's name; cleaners, the
// cleaning manager and owners get null.
export const GUEST_NAME_VISIBLE_ROLES = ['admin', 'super_admin', 'stays', 'ready', 'accounts'] as const;
export const guestNameVisible = (role: string | null | undefined): boolean => !!role && (GUEST_NAME_VISIBLE_ROLES as readonly string[]).includes(role);
// SQL: private.workspace_team_event_kinds(). You add your own; admins can change anyone's; the whole
// team sees them; owners never do.
export const TEAM_EVENTS_WINDOW_DAYS = 62;
export const TEAM_EVENTS_HIDDEN_FROM_ROLES = ['client'] as const;

// --- B7: management flags (migration 20261012140000_management_flags) -------------------------------
// SQL: private.workspace_flag_rules(). A reason (and a decline note) needs this many characters. Admins
// see all open flags plus this many days of decided ones; everyone else sees only their own.
export const FLAG_MIN_CHARS = 5;
export const FLAG_DECIDED_WINDOW_DAYS = 90;
// Everyone on the team can flag; owners cannot.
export const FLAG_BLOCKED_ROLES = ['client'] as const;

// --- A6 and B8: daily to-dos and notice routes (migration 20261012160000_daily_tasks_notice_routes) -
// SQL: workspace_daily_task_templates is created empty: no daily templates are seeded.
export const DAILY_TASK_TEMPLATES_SEEDED = 0;
// Listing health and pricing sit under client relations (the work view 'clients').
export const LISTING_HEALTH_VIEW = 'clients';

// --- A3: bonus display ------------------------------------------------------------------------------
// People see their bonus tier only, never a figure in pounds.
export const BONUS_DISPLAY = 'tier_only';

// --- C3: onboarding checklist -------------------------------------------------------------------------
// Today's seven phases until the client sends his own list (lib/workspace-view.ts is the source).
export const ONBOARDING_PHASES_DEFAULT: readonly string[] = ONBOARDING_PHASES;
