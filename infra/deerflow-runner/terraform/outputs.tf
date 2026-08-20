output "droplet_ipv4" {
  description = "Public IPv4 of the DeerFlow host. Point the DNS A record here when manage_dns is false."
  value       = digitalocean_droplet.deerflow.ipv4_address
}

output "droplet_private_ipv4" {
  description = "Private IPv4 used for managed-database traffic."
  value       = digitalocean_droplet.deerflow.ipv4_address_private
}

output "deerflow_hostname" {
  description = "Hostname for the Gateway front door. This becomes AIRA's DEERFLOW_API_BASE_URL, as https://<hostname>."
  value       = var.manage_dns ? "${var.dns_subdomain}.${var.dns_domain}" : null
}

output "database_host" {
  description = "Private hostname of the managed PostgreSQL cluster."
  value       = digitalocean_database_cluster.deerflow.private_host
}

output "database_port" {
  value = digitalocean_database_cluster.deerflow.port
}

# The connection URI contains the generated password. It is marked sensitive so
# it is redacted from plan and apply output; read it deliberately with
# `terraform output -raw database_url` and place it only in the DeerFlow host's
# .env, never in config.yaml and never in this repository.
output "database_url" {
  description = "PostgreSQL connection URI for DEERFLOW's DATABASE_URL. Sensitive."
  sensitive   = true
  value = format(
    "postgresql://%s:%s@%s:%d/%s?sslmode=require",
    digitalocean_database_user.deerflow.name,
    digitalocean_database_user.deerflow.password,
    digitalocean_database_cluster.deerflow.private_host,
    digitalocean_database_cluster.deerflow.port,
    digitalocean_database_db.deerflow.name,
  )
}
