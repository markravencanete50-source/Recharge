-- The first Hostaway sync (about 100 properties, 1,100 stays) ran past the 8 second limit that
-- server calls inherit from the connection role and was cancelled. Server-only calls (the sync,
-- the daily privacy job, security checks) get 60 seconds. Browser roles keep their short limits.
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
