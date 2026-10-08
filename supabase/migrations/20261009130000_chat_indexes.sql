-- Indexes for the new Messages and web push tables, so lookups stay quick as they grow
-- (flagged by the Supabase performance advisor). Safe to run more than once.
create index if not exists chat_reads_user_idx on private.chat_reads(user_id);
create index if not exists chat_conversations_created_by_idx on private.chat_conversations(created_by);
create index if not exists chat_conversations_property_idx on private.chat_conversations(property_id) where property_id is not null;
create index if not exists chat_conversations_work_idx on private.chat_conversations(work_id) where work_id is not null;
create index if not exists workspace_web_push_sent_subscription_idx on private.workspace_web_push_sent(subscription_id);
