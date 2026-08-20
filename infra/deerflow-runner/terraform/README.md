# AIRA DeerFlow host — Infrastructure as Code

Provisions the DeerFlow production host and its database. Everything else in the
activation flow (Docker, the pinned DeerFlow checkout, TLS, secrets) is handled
by `../scripts/provision-vps.sh`, which runs on the host this module creates.

## What it creates

| Resource | Purpose |
| --- | --- |
| `digitalocean_droplet` | The DeerFlow host. Default `s-4vcpu-8gb`, Ubuntu 24.04, in the region's VPC, with monitoring on. |
| `digitalocean_firewall` | Public 80/443 only; SSH restricted to `admin_ipv4_cidrs`. 2026, 8001, 6379 and 5432 are never opened. |
| `digitalocean_database_cluster` | Managed PostgreSQL, private networking, separate from AIRA's own Supabase database. |
| `digitalocean_database_db` / `_user` | A dedicated `deerflow` database and `deerflow_app` user. |
| `digitalocean_database_firewall` | Restricts the cluster to the DeerFlow droplet. |
| `digitalocean_record` | Optional A record, only when `manage_dns = true`. |

No GPU, no load balancer, no Kubernetes cluster, no second database: the model
provider and the sandbox are both external services.

## Usage

```bash
export DIGITALOCEAN_TOKEN=...          # never written to a file in this module
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: ssh_key_fingerprints and admin_ipv4_cidrs are required

terraform init
terraform plan      # review the billable resources before applying
terraform apply
```

Then read the connection string deliberately and place it on the host:

```bash
terraform output -raw database_url    # write into /opt/aira/deer-flow/.env as DATABASE_URL
terraform output droplet_ipv4         # DNS A record target when manage_dns = false
```

## Safety properties

- `admin_ipv4_cidrs` rejects `0.0.0.0/0` by validation, so SSH cannot be opened
  to the Internet by omission.
- `ssh_key_fingerprints` must be non-empty, so the droplet is never left relying
  on a mailed root password.
- The droplet and the database cluster both set `prevent_destroy`. The droplet
  carries `DEER_FLOW_HOME`; recreating either destroys persisted state, so it
  takes a deliberate taint.
- `database_url` is marked `sensitive`, so it is redacted from plan and apply
  output. It still lands in state — keep state private, and prefer a remote
  backend with encryption for anything beyond a single operator.
- `terraform.tfvars` and all state files are gitignored.

## Not validated by CI

CI runs `terraform fmt -check` and `terraform validate` only if a Terraform
binary is available on the runner. This module has not been applied against a
live DigitalOcean account, because no account has been authorized. Run
`terraform plan` and read it before the first apply.
