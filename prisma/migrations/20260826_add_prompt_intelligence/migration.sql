-- AIRA Prompt Intelligence
--
-- Prompt templates are user-authored content. They are stored here so the
-- runtime Prompt Compiler can place a *published, ownership-checked* version
-- into its own low-trust layer. External prompt material is captured with
-- provenance as untrusted reference data and is never executed directly.
--
-- Every table follows the repository's Supabase lockdown convention: row level
-- security on, an explicit deny-all policy for the Data API roles, and revoked
-- privileges. All access flows through server-side application code.

begin;

create type "PromptStatus" as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type "PromptVisibility" as enum ('PRIVATE', 'WORKSPACE');
create type "PromptOrigin" as enum ('AIRA_NATIVE', 'USER', 'EXTERNAL_DERIVED');
create type "PromptAssignmentScope" as enum ('WORKSPACE', 'CONVERSATION', 'AGENT');
create type "PromptExternalTransformStatus" as enum ('UNREVIEWED', 'REVIEWED', 'TRANSFORMED', 'REJECTED');
create type "PromptEvaluationRunStatus" as enum ('RUNNING', 'COMPLETED', 'FAILED');

-- ---------------------------------------------------------------------------
-- External reference catalog (untrusted data, created before Prompt so the
-- derived-template foreign key can be declared inline).
-- ---------------------------------------------------------------------------

create table "PromptExternalSource" (
  "id" text not null,
  "userId" text not null,
  "repository" text not null,
  "path" text not null,
  "url" text not null,
  "commitSha" text not null,
  "contentHash" text not null,
  "title" text not null,
  "category" text not null default 'uncategorized',
  "sourceLabel" text not null default 'external',
  "licenseNotice" text,
  "tags" text[] not null default array[]::text[],
  "body" text not null,
  "analysis" jsonb,
  "securityNotes" text,
  "transformationStatus" "PromptExternalTransformStatus" not null default 'UNREVIEWED',
  "retrievedAt" timestamp(3) not null default current_timestamp,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,

  constraint "PromptExternalSource_pkey" primary key ("id")
);

-- ---------------------------------------------------------------------------
-- Prompt identity and lifecycle
-- ---------------------------------------------------------------------------

create table "Prompt" (
  "id" text not null,
  "userId" text not null,
  "name" text not null,
  "slug" text not null,
  "description" text,
  "category" text not null default 'general',
  "tags" text[] not null default array[]::text[],
  "status" "PromptStatus" not null default 'DRAFT',
  "visibility" "PromptVisibility" not null default 'PRIVATE',
  "origin" "PromptOrigin" not null default 'USER',
  "publishedVersionId" text,
  "externalSourceId" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "archivedAt" timestamp(3),

  constraint "Prompt_pkey" primary key ("id")
);

-- Immutable body snapshots. Nothing in the application updates these rows.
create table "PromptVersion" (
  "id" text not null,
  "promptId" text not null,
  "userId" text not null,
  "version" integer not null,
  "body" text not null,
  "variables" jsonb not null default '[]',
  "providerCompatibility" text[] not null default array[]::text[],
  "modelCompatibility" text[] not null default array[]::text[],
  "toolRequirements" text[] not null default array[]::text[],
  "securityFindings" jsonb,
  "securityMaxSeverity" text,
  "notes" text,
  "contentHash" text not null,
  "createdAt" timestamp(3) not null default current_timestamp,

  constraint "PromptVersion_pkey" primary key ("id")
);

create table "PromptAssignment" (
  "id" text not null,
  "userId" text not null,
  "scope" "PromptAssignmentScope" not null,
  "targetKey" text not null,
  "promptId" text not null,
  "promptVersionId" text not null,
  "pinnedVersion" boolean not null default false,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,

  constraint "PromptAssignment_pkey" primary key ("id")
);

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------

create table "PromptEvaluationSuite" (
  "id" text not null,
  "userId" text not null,
  "promptId" text,
  "name" text not null,
  "description" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,

  constraint "PromptEvaluationSuite_pkey" primary key ("id")
);

create table "PromptEvaluationCase" (
  "id" text not null,
  "suiteId" text not null,
  "userId" text not null,
  "name" text not null,
  "input" text not null,
  "checks" jsonb not null default '[]',
  "tags" text[] not null default array[]::text[],
  "position" integer not null default 0,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,

  constraint "PromptEvaluationCase_pkey" primary key ("id")
);

create table "PromptEvaluationRun" (
  "id" text not null,
  "suiteId" text not null,
  "userId" text not null,
  "promptId" text not null,
  "promptVersionId" text not null,
  "providerId" text not null,
  "model" text not null,
  "routingMode" text,
  "status" "PromptEvaluationRunStatus" not null default 'RUNNING',
  "passCount" integer not null default 0,
  "failCount" integer not null default 0,
  "errorCount" integer not null default 0,
  "results" jsonb not null default '[]',
  "startedAt" timestamp(3) not null default current_timestamp,
  "finishedAt" timestamp(3),
  "durationMs" integer,

  constraint "PromptEvaluationRun_pkey" primary key ("id")
);

-- ---------------------------------------------------------------------------
-- Supabase Data API lockdown
-- ---------------------------------------------------------------------------

alter table "PromptExternalSource" enable row level security;
alter table "Prompt" enable row level security;
alter table "PromptVersion" enable row level security;
alter table "PromptAssignment" enable row level security;
alter table "PromptEvaluationSuite" enable row level security;
alter table "PromptEvaluationCase" enable row level security;
alter table "PromptEvaluationRun" enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array[
    'PromptExternalSource',
    'Prompt',
    'PromptVersion',
    'PromptAssignment',
    'PromptEvaluationSuite',
    'PromptEvaluationCase',
    'PromptEvaluationRun'
  ]
  loop
    execute format('drop policy if exists "deny_direct_data_api_access" on %I', target);
    execute format(
      'create policy "deny_direct_data_api_access" on %I for all to anon, authenticated using (false) with check (false)',
      target
    );
    execute format('revoke all privileges on table %I from anon, authenticated, service_role', target);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create unique index "PromptExternalSource_userId_contentHash_key"
  on "PromptExternalSource"("userId", "contentHash");
create index "PromptExternalSource_userId_createdAt_idx"
  on "PromptExternalSource"("userId", "createdAt" desc);
create index "PromptExternalSource_userId_category_idx"
  on "PromptExternalSource"("userId", "category");

create unique index "Prompt_publishedVersionId_key" on "Prompt"("publishedVersionId");
create unique index "Prompt_userId_slug_key" on "Prompt"("userId", "slug");
create index "Prompt_userId_updatedAt_idx" on "Prompt"("userId", "updatedAt" desc);
create index "Prompt_userId_status_updatedAt_idx" on "Prompt"("userId", "status", "updatedAt" desc);
create index "Prompt_externalSourceId_idx" on "Prompt"("externalSourceId");

create unique index "PromptVersion_promptId_version_key" on "PromptVersion"("promptId", "version");
create index "PromptVersion_promptId_createdAt_idx" on "PromptVersion"("promptId", "createdAt" desc);
create index "PromptVersion_userId_createdAt_idx" on "PromptVersion"("userId", "createdAt" desc);

create unique index "PromptAssignment_userId_scope_targetKey_key"
  on "PromptAssignment"("userId", "scope", "targetKey");
create index "PromptAssignment_userId_updatedAt_idx" on "PromptAssignment"("userId", "updatedAt" desc);
create index "PromptAssignment_promptId_idx" on "PromptAssignment"("promptId");
create index "PromptAssignment_promptVersionId_idx" on "PromptAssignment"("promptVersionId");

create index "PromptEvaluationSuite_userId_updatedAt_idx"
  on "PromptEvaluationSuite"("userId", "updatedAt" desc);
create index "PromptEvaluationSuite_promptId_idx" on "PromptEvaluationSuite"("promptId");

create index "PromptEvaluationCase_suiteId_position_idx" on "PromptEvaluationCase"("suiteId", "position");
create index "PromptEvaluationCase_userId_createdAt_idx" on "PromptEvaluationCase"("userId", "createdAt" desc);

create index "PromptEvaluationRun_userId_startedAt_idx" on "PromptEvaluationRun"("userId", "startedAt" desc);
create index "PromptEvaluationRun_promptId_startedAt_idx" on "PromptEvaluationRun"("promptId", "startedAt" desc);
create index "PromptEvaluationRun_suiteId_startedAt_idx" on "PromptEvaluationRun"("suiteId", "startedAt" desc);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

alter table "PromptExternalSource"
  add constraint "PromptExternalSource_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

alter table "Prompt"
  add constraint "Prompt_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

alter table "Prompt"
  add constraint "Prompt_publishedVersionId_fkey"
  foreign key ("publishedVersionId") references "PromptVersion"("id")
  on delete set null on update cascade;

alter table "Prompt"
  add constraint "Prompt_externalSourceId_fkey"
  foreign key ("externalSourceId") references "PromptExternalSource"("id")
  on delete set null on update cascade;

alter table "PromptVersion"
  add constraint "PromptVersion_promptId_fkey"
  foreign key ("promptId") references "Prompt"("id")
  on delete cascade on update cascade;

alter table "PromptAssignment"
  add constraint "PromptAssignment_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

alter table "PromptAssignment"
  add constraint "PromptAssignment_promptId_fkey"
  foreign key ("promptId") references "Prompt"("id")
  on delete cascade on update cascade;

alter table "PromptAssignment"
  add constraint "PromptAssignment_promptVersionId_fkey"
  foreign key ("promptVersionId") references "PromptVersion"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationSuite"
  add constraint "PromptEvaluationSuite_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationSuite"
  add constraint "PromptEvaluationSuite_promptId_fkey"
  foreign key ("promptId") references "Prompt"("id")
  on delete set null on update cascade;

alter table "PromptEvaluationCase"
  add constraint "PromptEvaluationCase_suiteId_fkey"
  foreign key ("suiteId") references "PromptEvaluationSuite"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationRun"
  add constraint "PromptEvaluationRun_suiteId_fkey"
  foreign key ("suiteId") references "PromptEvaluationSuite"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationRun"
  add constraint "PromptEvaluationRun_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationRun"
  add constraint "PromptEvaluationRun_promptId_fkey"
  foreign key ("promptId") references "Prompt"("id")
  on delete cascade on update cascade;

alter table "PromptEvaluationRun"
  add constraint "PromptEvaluationRun_promptVersionId_fkey"
  foreign key ("promptVersionId") references "PromptVersion"("id")
  on delete cascade on update cascade;

notify pgrst, 'reload schema';

commit;
