-- TruthMode IV follow-up: durable encrypted connector connection records.
-- Credential ciphertext is server-only and never exposed through the direct Data API.

CREATE TABLE IF NOT EXISTS "ConnectorConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "connectorId" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ConnectorConnection_userId_connectorId_idx"
    ON "ConnectorConnection"("userId", "connectorId");

ALTER TABLE "ConnectorConnection" ENABLE ROW LEVEL SECURITY;

do $$
begin
    begin
        CREATE POLICY "deny_direct_data_api_access"
            ON "ConnectorConnection"
            FOR ALL
            TO anon, authenticated
            USING (false)
            WITH CHECK (false);
    exception when duplicate_object then
        null;
    end;
end
$$;

REVOKE ALL PRIVILEGES ON TABLE "ConnectorConnection"
    FROM anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
