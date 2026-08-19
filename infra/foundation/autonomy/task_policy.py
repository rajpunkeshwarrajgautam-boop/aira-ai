#!/usr/bin/env python3
import argparse
import json
import sys

DEFAULT_POLICY = {
    "max_wall_seconds": 900,
    "max_steps": 40,
    "allowed_capabilities": ["web.read", "repo.read", "code.sandbox"],
    "require_human_approval": ["repo.write", "deploy", "send", "purchase", "delete", "credential.use"],
}


def evaluate(request, policy):
    requested = set(request.get("capabilities") or [])
    allowed = set(policy.get("allowed_capabilities") or [])
    approval = set(policy.get("require_human_approval") or [])
    denied = sorted(requested - allowed - approval)
    approval_required = sorted(requested & approval)
    wall = int(request.get("max_wall_seconds") or 0)
    steps = int(request.get("max_steps") or 0)
    if wall > int(policy.get("max_wall_seconds", 0)):
        denied.append("wall_time_limit")
    if steps > int(policy.get("max_steps", 0)):
        denied.append("step_limit")
    return {
        "allowed": not denied and not approval_required,
        "requires_human_approval": bool(approval_required) and not denied,
        "approval_capabilities": approval_required,
        "denied": denied,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request")
    parser.add_argument("--policy")
    args = parser.parse_args()
    with open(args.request, "r", encoding="utf-8") as handle:
        request = json.load(handle)
    policy = DEFAULT_POLICY
    if args.policy:
        with open(args.policy, "r", encoding="utf-8") as handle:
            policy = json.load(handle)
    result = evaluate(request, policy)
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["allowed"] or result["requires_human_approval"] else 2


if __name__ == "__main__":
    sys.exit(main())
