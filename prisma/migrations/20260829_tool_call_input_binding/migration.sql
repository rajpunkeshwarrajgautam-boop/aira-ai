begin;

alter table "AgentToolCall"
  add column if not exists "inputHash" text;

-- Existing development rows cannot safely be reconstructed from the redacted
-- input summary. Give them a non-replayable legacy binding; new requests always
-- persist a SHA-256 hash of the canonical full input before approval/execution.
update "AgentToolCall"
set "inputHash"='legacy:' || "id"
where "inputHash" is null;

alter table "AgentToolCall"
  alter column "inputHash" set not null;

create index if not exists "AgentToolCall_inputHash_idx"
  on "AgentToolCall" ("inputHash");

commit;
