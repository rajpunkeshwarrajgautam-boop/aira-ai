-- Covering index for PromptEvaluationRun.promptVersionId
--
-- Every other foreign key introduced by 20260826_add_prompt_intelligence has a
-- covering index; this one was missed. Without it, deleting or cascading from a
-- PromptVersion sequentially scans PromptEvaluationRun, and the Supabase
-- performance linter reports the constraint as unindexed.
--
-- Additive and idempotent: creates one index, changes no table, column,
-- constraint or policy.

begin;

create index if not exists "PromptEvaluationRun_promptVersionId_idx"
  on "PromptEvaluationRun"("promptVersionId");

commit;
