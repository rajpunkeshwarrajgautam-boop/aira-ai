-- TruthMode IV final guard: workflow definitions must never persist embedded credentials.
-- Application validation rejects unsafe DAGs before writes; these constraints provide a
-- database-level fail-closed backstop for all server/internal persistence paths.

CREATE OR REPLACE FUNCTION public.aira_workflow_contains_secret_key(document jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    item_key text;
    normalized_key text;
    item_value jsonb;
BEGIN
    IF jsonb_typeof(document) = 'object' THEN
        FOR item_key, item_value IN SELECT key, value FROM jsonb_each(document)
        LOOP
            normalized_key := lower(regexp_replace(item_key, '[-_]', '', 'g'));
            IF normalized_key = ANY (ARRAY[
                'credential',
                'credentials',
                'accesstoken',
                'refreshtoken',
                'bearertoken',
                'authtoken',
                'sessiontoken',
                'apikey',
                'clientsecret',
                'signingsecret',
                'password',
                'secret',
                'privatekey'
            ]) THEN
                RETURN true;
            END IF;

            IF jsonb_typeof(item_value) IN ('object', 'array')
               AND public.aira_workflow_contains_secret_key(item_value) THEN
                RETURN true;
            END IF;
        END LOOP;
    ELSIF jsonb_typeof(document) = 'array' THEN
        FOR item_value IN SELECT value FROM jsonb_array_elements(document)
        LOOP
            IF jsonb_typeof(item_value) IN ('object', 'array')
               AND public.aira_workflow_contains_secret_key(item_value) THEN
                RETURN true;
            END IF;
        END LOOP;
    END IF;

    RETURN false;
END;
$$;

ALTER TABLE "AutomationRoutine"
    ADD CONSTRAINT "AutomationRoutine_workflowDag_no_secrets"
    CHECK (NOT public.aira_workflow_contains_secret_key("workflowDag"))
    NOT VALID;

ALTER TABLE "AutomationRoutineVersion"
    ADD CONSTRAINT "AutomationRoutineVersion_workflowDag_no_secrets"
    CHECK (NOT public.aira_workflow_contains_secret_key("workflowDag"))
    NOT VALID;

ALTER TABLE "AutomationRoutine"
    VALIDATE CONSTRAINT "AutomationRoutine_workflowDag_no_secrets";

ALTER TABLE "AutomationRoutineVersion"
    VALIDATE CONSTRAINT "AutomationRoutineVersion_workflowDag_no_secrets";

-- The function contains no data access and must remain executable by the server DB role so
-- CHECK constraints work even when migrations and runtime use distinct roles. Direct Data API
-- roles are explicitly denied execution.
REVOKE ALL ON FUNCTION public.aira_workflow_contains_secret_key(jsonb)
    FROM anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
