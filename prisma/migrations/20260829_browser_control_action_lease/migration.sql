begin;

alter table "BrowserSession"
  add column if not exists "actionLeaseOwner" text,
  add column if not exists "actionLeaseExpiresAt" timestamp(3);

create index if not exists "BrowserSession_actionLease_idx"
  on "BrowserSession" ("status", "actionLeaseExpiresAt");

commit;
