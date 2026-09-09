-- Phase 6 security: durable, concurrency-safe anonymous search quota reservations.
-- Provider-spend attempts are reserved before outbound model/search execution so
-- parallel anonymous requests cannot race a completed-event counter.

CREATE TABLE IF NOT EXISTS "AnonymousSearchQuotaReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anonymousId" TEXT NOT NULL,
    "eventDay" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AnonymousSearchQuotaReservation_anonymousId_eventDay_idx"
    ON "AnonymousSearchQuotaReservation"("anonymousId", "eventDay");

ALTER TABLE "AnonymousSearchQuotaReservation" ENABLE ROW LEVEL SECURITY;

do $$
begin
  begin
    create policy "deny_direct_data_api_access"
      on public."AnonymousSearchQuotaReservation"
      for all to anon, authenticated
      using (false)
      with check (false);
  exception when duplicate_object then
    null;
  end;
end
$$;

REVOKE ALL PRIVILEGES ON TABLE "AnonymousSearchQuotaReservation"
FROM anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
