-- Nothing pending. Every migration in supabase/migrations is installed in the Supabase project.
-- 20261021100000_chat_voice_notes: the safe part was installed by the lead on 14 October 2026; Lee ran the
-- check swap (the part with a DROP) on 15 October 2026. It went live with the voice notes pull request.
-- 20261021200000_repair_contractors: installed by the lead on 15 October 2026 (no DROP or DELETE). It went live with the repairs with contractors pull request.
-- 20261021300000_role_home, 20261021400000_chat_mentions, 20261021500000_cleaner_flow and 20261021600000_stay_analytics: installed together by the lead
-- on 15 October 2026 (no DROP or DELETE). They went live with the chat mentions, cleaner flow, role Home and stay analytics pull request.
-- 20261021700000_repair_owner_contractor_times: installed by the lead on 15 October 2026 (no DROP or DELETE).
-- 20261021900000_cleaner_notices_phone_only: installed by the lead on 15 October 2026 (no DROP or DELETE).
-- 20261021800000_stay_reason: installed by the lead on 15 October 2026 (no DROP or DELETE). Both switches (ask and survey) are OFF.
-- 20261022000000_cleaner_invoices (requests for invoice): installed by the lead on 15 October 2026 (no DROP or DELETE).
-- 20261022050000_clean_outcome_flags: installed by the lead on 15 October 2026 (no DROP or DELETE).
-- 20261022200000_va_pay: installed by the lead on 15 October 2026 (no DROP or DELETE).
-- 20261022100000_recharge_invoices: installed by the lead on 15 October 2026 (no DROP or DELETE). Payment details are blank until entered in the app.
-- 20261022300000_owner_enquiries: installed by the lead on 16 October 2026 (no DROP or DELETE).
-- 20261022400000_team_enquiries: installed by the lead on 16 October 2026 (no DROP or DELETE).
-- 20261022500000_property_ratings: installed by the lead on 16 October 2026 (no DROP or DELETE).
-- 20261022700000_admin_access_control: installed by the lead on 16 October 2026 (no DROP or DELETE). workspace_access_control_action matches with comments ignored (live lacked two comment lines before).
-- 20261022800000_property_edit: installed by the lead on 16 October 2026 (no DROP or DELETE).
-- 20261023000000_review_sweep: installed by the lead on 16 October 2026 (no DROP or DELETE; adds three columns to the review state).
-- 20261023100000_cleaner_repairs: installed by the lead on 17 October 2026 (no DROP or DELETE).
-- 20261023200000_furnishing_studio: installed by the lead on 17 October 2026 (no DROP or DELETE; six new tables, 97 catalogue items).
-- 20261023300000_report_analytics: installed by the lead on 18 October 2026 (no DROP or DELETE; patches the ratings and business report reads).
-- 20261024100000_agreement_signature: installed by the lead on 18 October 2026 (no DROP or DELETE; adds the drawn signature column and lets the team edit the contract wording).
-- 20261024200000_enquiry_delete_repair_limits: installed by Lee in the SQL editor on 20 October 2026, approved (adds two DELETE lines to the enquiry delete function for repair limits and their history); verified by the lead.
-- 20261025100000_todo_like_clickup: installed by Lee in the SQL editor on 20 October 2026 (no DROP of data or DELETE; drop trigger if exists only; three new tables, two to-do columns, patches the hub view, visibility and actions); verified by the lead.
-- 20261025200000_client_onboarding_framework: installed by Lee in the SQL editor on 20 October 2026 (no DROP of data or DELETE; replaces the enquiry source check to allow website enquiries; two new tables); verified by the lead.
-- 20261025300000_lead_estimate_delivery: installed by Lee in the SQL editor on 20 October 2026 (no DROP or DELETE; three new tables and the lead-files bucket); verified by the lead.
-- 20261025400000_push_message_time: installed by Lee in the SQL editor on 20 October 2026 (no DROP or DELETE; the push claim returns each message's time); verified by the lead.

-- 20261025500000 lead_files_guest_push, 20261025600000 shift_hours_clip_open_limit, 20261025700000 view_as_super_admins: installed by Lee 2026-10-20, verified

-- 20261025800000 operations_read_kind: installed by Lee 2026-10-20, verified

-- 20261025900000 operations_read_fast: installed by Lee 2026-10-20, verified

-- 20261026000000 guest_translations, 20261026100000 guest_translations_more: installed by Lee 2026-10-22, verified
-- 20261026200000 website_guest_messages, 20261027100000 website_live_chat, 20261027200000 agreement_follow_ups: installed by Lee 2026-10-27, verified

-- 20261027300000 onboarding_fee: installed by Lee 2026-10-27, verified


-- 20261027400000 property_chat: installed by Lee 2026-10-27, verified

-- 20261027500000 owner_enquiry_stage: installed by Lee 2026-10-27, verified

-- 20261028100000 onboarding_package: installed by Lee 2026-10-27, verified

-- 20261028200000 hostaway_listing: installed by Lee 2026-10-28, verified

-- 20261029100000 launch_preparation: installed by Lee 2026-10-28, verified

-- 20261029200000 launch_compliance_boards: installed by Lee 2026-10-28, verified

-- 20261029300000 launch_furnishing: installed by Lee 2026-10-28, verified

-- 20261029400000 launch_inventory: installed by Lee 2026-10-28, verified
-- 20261029500000 Launch Preparation guidebook: installed by Lee 2026-10-28, verified
-- 20261029600000 Recruitment: installed by Lee 2026-10-28, verified
-- 20261029700000 launch_compliance_jobs: installed by Lee 2026-10-28, verified
-- 20261029800000 launch_garden_quotes: installed by Lee 2026-10-29, verified
-- 20261029900000 launch_condition_repairs: installed by Lee 2026-10-29, verified
