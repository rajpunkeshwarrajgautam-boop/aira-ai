# AIRA DeerFlow production host.
#
# Creates the minimum billable footprint the runbook requires: one droplet, one
# managed PostgreSQL cluster, and the firewalls that keep everything except the
# TLS front door off the public Internet.
#
# Deliberately NOT created here: a load balancer, a Kubernetes cluster, GPU
# nodes, or a second database. DeerFlow's model provider is external, so the host
# needs no GPU, and a single node is the documented launch architecture.

locals {
  droplet_name  = "${var.name_prefix}-host"
  database_name = "deerflow"
  database_user = "deerflow_app"
}

data "digitalocean_vpc" "default" {
  region = var.region
}

resource "digitalocean_droplet" "deerflow" {
  name     = local.droplet_name
  region   = var.region
  size     = var.droplet_size
  image    = var.droplet_image
  ssh_keys = var.ssh_key_fingerprints

  monitoring = true
  ipv6       = true

  # Join the region's VPC so managed-database traffic uses the private network
  # rather than the public interface.
  vpc_uuid = data.digitalocean_vpc.default.id

  tags = ["aira", "deerflow", "production"]

  lifecycle {
    # The host carries DEER_FLOW_HOME. Replacing the droplet destroys persisted
    # threads and artifacts, so require a deliberate taint rather than letting an
    # attribute change silently recreate it.
    prevent_destroy = true
  }
}

# ── Host firewall ───────────────────────────────────────────────────────────
# Public: 80 and 443 only, plus SSH restricted to the admin CIDRs. The Gateway
# (8001), nginx's own port (2026), Redis (6379) and PostgreSQL (5432) are never
# opened: nginx binds to loopback and the TLS proxy reaches it from the host.
resource "digitalocean_firewall" "deerflow" {
  name        = "${var.name_prefix}-host-fw"
  droplet_ids = [digitalocean_droplet.deerflow.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.admin_ipv4_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Egress is unrestricted: the host must reach the model provider, the E2B
  # control plane, container registries and ACME.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# ── Managed PostgreSQL ──────────────────────────────────────────────────────
# Separate from AIRA's own Supabase database. DeerFlow's checkpointer, store and
# application tables are its internal schema and must not share AIRA's
# application database.
resource "digitalocean_database_cluster" "deerflow" {
  name       = "${var.name_prefix}-pg"
  engine     = "pg"
  version    = var.database_version
  size       = var.database_size
  region     = var.region
  node_count = 1

  private_network_uuid = data.digitalocean_vpc.default.id

  tags = ["aira", "deerflow", "production"]

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_database_db" "deerflow" {
  cluster_id = digitalocean_database_cluster.deerflow.id
  name       = local.database_name
}

resource "digitalocean_database_user" "deerflow" {
  cluster_id = digitalocean_database_cluster.deerflow.id
  name       = local.database_user
}

# Only the DeerFlow droplet may open a connection to the cluster.
resource "digitalocean_database_firewall" "deerflow" {
  cluster_id = digitalocean_database_cluster.deerflow.id

  rule {
    type  = "droplet"
    value = digitalocean_droplet.deerflow.id
  }
}

# ── DNS (optional) ──────────────────────────────────────────────────────────
resource "digitalocean_record" "deerflow" {
  count = var.manage_dns ? 1 : 0

  domain = var.dns_domain
  type   = "A"
  name   = var.dns_subdomain
  value  = digitalocean_droplet.deerflow.ipv4_address
  ttl    = 300
}
