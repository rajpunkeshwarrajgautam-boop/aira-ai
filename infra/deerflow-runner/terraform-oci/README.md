# AIRA DeerFlow host — Oracle Cloud Always Free

A $0-recurring-cost alternative to `../terraform/`, which provisions paid
DigitalOcean infrastructure. Both are kept: this one for launch, that one as the
documented scaling path.

Everything that would otherwise be a paid managed service runs on the single
instance: PostgreSQL, Redis, and the sandbox runtime on a local k3s cluster.

## What it creates

| Resource | Always Free position |
| --- | --- |
| `oci_core_instance` | `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, Ubuntu 24.04 **aarch64**. The A1 pool is 4 OCPU / 24 GB across the tenancy, so this uses half. |
| Boot volume | 100 GB. The block-storage entitlement is 200 GB in total and boot volumes count. |
| `oci_core_vcn`, subnet, Internet Gateway, route table, security list | No charge. |

**Not created, because each is billable:** NAT Gateway (the public subnet plus
Internet Gateway provides egress), Load Balancer (Caddy on the instance
terminates TLS), OCI Autonomous Database, OKE managed Kubernetes, and any extra
block volume.

## Guardrails

The variable validations refuse to produce a plan that drifts into a charge:

- `shape` accepts only `VM.Standard.A1.Flex`. Changing it must be a deliberate
  edit to `variables.tf`, not a `-var` override.
- `instance_ocpus` ≤ 4 and `instance_memory_gb` ≤ 24 — the tenancy-wide A1 pool.
- `boot_volume_gb` ≤ 150, leaving headroom inside the 200 GB entitlement.
- `admin_ipv4_cidrs` rejects `0.0.0.0/0`.
- `ssh_public_key` rejects anything containing `PRIVATE KEY`.
- The instance sets `prevent_destroy`: it carries `DEER_FLOW_HOME`, the
  PostgreSQL data directory and k3s state.

The Ubuntu image is resolved at plan time by a `oci_core_images` data source
rather than a hard-coded OCID, which goes stale as Oracle republishes images. A
precondition fails the plan with a readable message if no aarch64 image matches.

## Usage

```bash
oci setup config            # writes ~/.oci/config; never a Terraform variable
cp terraform.tfvars.example terraform.tfvars
# fill in compartment_ocid, ssh_public_key, admin_ipv4_cidrs

terraform init
terraform validate
terraform plan              # read it before applying
terraform apply
```

### A1 capacity

Always Free A1 capacity is frequently exhausted. Terraform surfaces Oracle's
`Out of host capacity` error directly. Retry in another availability domain via
`availability_domain`, or retry later. **Do not switch to a billable shape** —
the validation exists to make that a conscious act.

## Verifying $0

A successful `terraform apply` is not evidence of zero cost. Confirm against the
live account:

1. Console → Billing & Cost Management → **Cost Analysis**, filtered to this
   compartment, after the resources have existed for a full day.
2. Console → Governance → **Limits, Quotas and Usage**, service `compute`, to
   confirm the A1 usage sits inside the Always Free allowance.
3. Each resource's detail page shows an **Always Free eligible** badge.

Only claim `$0.00/month` once those agree. If a charge appears, identify the
resource before deleting anything — the instance holds persistent state.

## Availability caveat

This is a free-tier deployment and is materially less available than paid
infrastructure. Oracle may reclaim or constrain Always Free capacity under its
free-tier policy, and there is no redundancy: one instance, one AZ, no managed
database failover. AIRA is designed for this — if DeerFlow disappears, AIRA fails
closed and search, auth and memory keep working. Recovery is: re-apply this
module, restore the PostgreSQL dump and `DEER_FLOW_HOME`, re-run the provisioner.
