variable "region" {
  description = "DigitalOcean region slug. Keep the droplet and the database cluster in the same region so database traffic stays on the private network."
  type        = string
  default     = "blr1"
}

variable "droplet_size" {
  description = "Droplet size slug. s-4vcpu-8gb matches the documented DeerFlow host class: the Gateway, frontend, nginx and Redis containers plus image builds."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "droplet_image" {
  description = "Base image. The provisioning script supports Debian/Ubuntu hosts with apt-get."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "name_prefix" {
  description = "Prefix applied to every created resource so they are identifiable in the DigitalOcean console."
  type        = string
  default     = "aira-deerflow"
}

variable "ssh_key_fingerprints" {
  description = "Fingerprints of SSH keys already uploaded to the DigitalOcean account. At least one is required: without it the droplet is only reachable through the console password emailed by DigitalOcean."
  type        = list(string)

  validation {
    condition     = length(var.ssh_key_fingerprints) > 0
    error_message = "Provide at least one SSH key fingerprint, or the host cannot be provisioned non-interactively."
  }
}

variable "admin_ipv4_cidrs" {
  description = "Source CIDRs allowed to reach SSH. Defaulting to the whole Internet would leave port 22 globally exposed, so this must be set explicitly."
  type        = list(string)

  validation {
    condition     = length(var.admin_ipv4_cidrs) > 0 && !contains(var.admin_ipv4_cidrs, "0.0.0.0/0")
    error_message = "Set at least one specific admin CIDR. 0.0.0.0/0 is rejected: SSH must not be open to the Internet."
  }
}

variable "database_size" {
  description = "Managed PostgreSQL node size. db-s-1vcpu-1gb is the smallest production node and is sufficient for DeerFlow's checkpointer, store and application tables at launch scale."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "database_version" {
  description = "Managed PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "manage_dns" {
  description = "Whether to create the DNS A record. Set false when the domain's DNS is hosted somewhere other than DigitalOcean; the record must then be created manually against the droplet_ipv4 output."
  type        = bool
  default     = false
}

variable "dns_domain" {
  description = "Apex domain already managed in DigitalOcean DNS, for example example.com. Only used when manage_dns is true."
  type        = string
  default     = ""
}

variable "dns_subdomain" {
  description = "Subdomain for the DeerFlow Gateway front door. The resulting hostname becomes AIRA's DEERFLOW_API_BASE_URL."
  type        = string
  default     = "agents"
}
