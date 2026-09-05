-- Historical database baseline for disposable migration-chain verification.
--
-- AIRA's repository began with an already-populated Prisma schema and did not
-- record the original schema creation as a Prisma migration. This baseline is
-- intentionally kept OUTSIDE prisma/migrations so an existing deployment will
-- never execute it through `prisma migrate deploy`.
--
-- CI applies this file only to a brand-new disposable PostgreSQL database,
-- then runs the recorded Prisma migrations from 20260512 onward.
-- Source of truth: prisma/schema.prisma at repository root commit
-- 81982a80701ff3540a0447856f6f08e927e62bd3.

begin;

create type "BillingPlan" as enum ('FREE', 'PRO', 'TEAM');
create type "SubscriptionStatus" as enum (
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
  'PAUSED'
);
create type "AnalyticsEventType" as enum (
  'VISITOR_LANDED',
  'SIGNUP_COMPLETED',
  'SEARCH_STANDARD',
  'SEARCH_DEEP',
  'SHARE_CREATED',
  'UPGRADE_CHECKOUT_STARTED',
  'UPGRADE_COMPLETED',
  'QUOTA_EXCEEDED',
  'PLAN_REQUIRED',
  'SEARCH_ERROR',
  'ERROR_EVENT'
);
create type "ConversationMessageRole" as enum ('USER', 'ASSISTANT', 'SYSTEM');

create table "User" (
  "id" text not null,
  "name" text,
  "email" text,
  "emailVerified" timestamp(3),
  "image" text,
  "billingPhone" text,
  "billingPlan" "BillingPlan" not null default 'FREE',
  constraint "User_pkey" primary key ("id")
);

create table "Account" (
  "id" text not null,
  "userId" text not null,
  "type" text not null,
  "provider" text not null,
  "providerAccountId" text not null,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  constraint "Account_pkey" primary key ("id"),
  constraint "Account_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create table "Session" (
  "id" text not null,
  "sessionToken" text not null,
  "userId" text not null,
  "expires" timestamp(3) not null,
  constraint "Session_pkey" primary key ("id"),
  constraint "Session_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create table "VerificationToken" (
  "identifier" text not null,
  "token" text not null,
  "expires" timestamp(3) not null
);

create table "BillingSubscription" (
  "id" text not null,
  "userId" text not null,
  "cfSubscriptionId" text not null,
  "merchantSubscriptionId" text not null,
  "cashfreePlanId" text not null,
  "plan" "BillingPlan" not null,
  "status" "SubscriptionStatus" not null,
  "currentPeriodStart" timestamp(3),
  "currentPeriodEnd" timestamp(3),
  "cancelAtPeriodEnd" boolean not null default false,
  "teamSeats" integer not null default 1,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "BillingSubscription_pkey" primary key ("id"),
  constraint "BillingSubscription_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create table "UsageRecord" (
  "id" text not null,
  "userId" text not null,
  "periodStart" timestamp(3) not null,
  "searches" integer not null default 0,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "UsageRecord_pkey" primary key ("id"),
  constraint "UsageRecord_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create table "ProcessedCashfreeWebhook" (
  "id" text not null,
  "receivedAt" timestamp(3) not null default current_timestamp,
  constraint "ProcessedCashfreeWebhook_pkey" primary key ("id")
);

create table "Conversation" (
  "id" text not null,
  "userId" text not null,
  "title" text not null,
  "archivedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  "lastMessageAt" timestamp(3) not null default current_timestamp,
  constraint "Conversation_pkey" primary key ("id"),
  constraint "Conversation_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade
);

create table "ConversationMessage" (
  "id" text not null,
  "conversationId" text not null,
  "userId" text not null,
  "role" "ConversationMessageRole" not null,
  "content" text not null,
  "parentMessageId" text,
  "citations" jsonb,
  "metadata" jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "ConversationMessage_pkey" primary key ("id"),
  constraint "ConversationMessage_conversationId_fkey" foreign key ("conversationId") references "Conversation"("id") on delete cascade on update cascade,
  constraint "ConversationMessage_parentMessageId_fkey" foreign key ("parentMessageId") references "ConversationMessage"("id") on delete set null on update cascade
);

create table "ResearchHistory" (
  "id" text not null,
  "userId" text not null,
  "conversationId" text,
  "messageId" text,
  "query" text not null,
  "normalizedQuery" text not null,
  "assistantAnswer" text not null,
  "citationCount" integer not null default 0,
  "citations" jsonb,
  "exaRequestId" text,
  "exaSearchType" text,
  "publicShareToken" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "ResearchHistory_pkey" primary key ("id"),
  constraint "ResearchHistory_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade,
  constraint "ResearchHistory_conversationId_fkey" foreign key ("conversationId") references "Conversation"("id") on delete set null on update cascade,
  constraint "ResearchHistory_messageId_fkey" foreign key ("messageId") references "ConversationMessage"("id") on delete set null on update cascade
);

create table "AnalyticsVisitorState" (
  "anonymousId" text not null,
  "firstLandedAt" timestamp(3) not null default current_timestamp,
  "lastSeenAt" timestamp(3) not null default current_timestamp,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "AnalyticsVisitorState_pkey" primary key ("anonymousId")
);

create table "AnalyticsSignupState" (
  "userId" text not null,
  "anonymousId" text,
  "signupAt" timestamp(3) not null default current_timestamp,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "AnalyticsSignupState_pkey" primary key ("userId")
);

create table "AnalyticsEvent" (
  "id" text not null,
  "type" "AnalyticsEventType" not null,
  "eventDay" timestamp(3) not null,
  "createdAt" timestamp(3) not null default current_timestamp,
  "anonymousId" text,
  "userId" text,
  "plan" "BillingPlan",
  "metadata" jsonb,
  constraint "AnalyticsEvent_pkey" primary key ("id")
);

create unique index "User_email_key" on "User"("email");
create unique index "Account_provider_providerAccountId_key" on "Account"("provider", "providerAccountId");
create unique index "Session_sessionToken_key" on "Session"("sessionToken");
create unique index "VerificationToken_token_key" on "VerificationToken"("token");
create unique index "VerificationToken_identifier_token_key" on "VerificationToken"("identifier", "token");
create unique index "BillingSubscription_userId_key" on "BillingSubscription"("userId");
create unique index "BillingSubscription_cfSubscriptionId_key" on "BillingSubscription"("cfSubscriptionId");
create unique index "BillingSubscription_merchantSubscriptionId_key" on "BillingSubscription"("merchantSubscriptionId");
create unique index "UsageRecord_userId_periodStart_key" on "UsageRecord"("userId", "periodStart");
create index "Conversation_userId_lastMessageAt_idx" on "Conversation"("userId", "lastMessageAt" desc);
create index "ConversationMessage_conversationId_createdAt_idx" on "ConversationMessage"("conversationId", "createdAt");
create index "ConversationMessage_conversationId_parentMessageId_idx" on "ConversationMessage"("conversationId", "parentMessageId");
create index "ConversationMessage_userId_createdAt_idx" on "ConversationMessage"("userId", "createdAt" desc);
create unique index "ResearchHistory_publicShareToken_key" on "ResearchHistory"("publicShareToken");
create index "ResearchHistory_userId_createdAt_idx" on "ResearchHistory"("userId", "createdAt" desc);
create index "ResearchHistory_conversationId_createdAt_idx" on "ResearchHistory"("conversationId", "createdAt" desc);
create index "ResearchHistory_normalizedQuery_createdAt_idx" on "ResearchHistory"("normalizedQuery", "createdAt" desc);
create index "AnalyticsEvent_eventDay_idx" on "AnalyticsEvent"("eventDay");
create index "AnalyticsEvent_type_eventDay_idx" on "AnalyticsEvent"("type", "eventDay");
create index "AnalyticsEvent_anonymousId_eventDay_idx" on "AnalyticsEvent"("anonymousId", "eventDay");
create index "AnalyticsEvent_userId_eventDay_idx" on "AnalyticsEvent"("userId", "eventDay");

commit;
