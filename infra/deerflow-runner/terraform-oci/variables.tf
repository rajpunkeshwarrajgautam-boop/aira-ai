# ── Always Free guardrails ──────────────────────────────────────────────────
# Oracle's Always Free Ampere A1 allowance is 4 OCPU and 24 GB of memory in
# total across every A1 instance in the tenancy, and 200 GB total block storage.
# The validations below refuse to build a plan that exceeds those ceilings or
# silently switches to a billable shape. They are intentionally strict: a future
# operator should have to edit this file on purpose, not drift into a charge.

variable "shape" {
  description = "Compute shape. Locked to the Always Free Ampere A1 flexible shape."
  type        = string
  default     = "VM.Standard.A1.Flex"

  validation {
    condition     = var.shape == "VM.Standard.A1.Flex"
    error_message = "Only VM.Standard.A1.Flex is permitted. Every other shape is billable or not Always Free eligible; changing this must be a deliberate edit, not a variable override."
  }
}

variable "instance_ocpus" {
  description = "OCPUs for the instance. The Always Free A1 pool is 4 OCPU in total across the tenancy; 2 leaves headroom for a second instance."
  type        = number
  default     = 2

  validation {
    condition     = var.instance_ocpus >= 1 && var.instance_ocpus <= 4
    error_message = "OCPUs must be between 1 and 4. The Always Free A1 allowance is 4 OCPU across the whole tenancy."
  }
}

variable "instance_memory_gb" {
  description = "Memory in GB. The Always Free A1 pool is 24 GB in total across the tenancy."
  type        = number
  default     = 12

  validation {
    condition     = var.instance_memory_gb >= 6 && var.instance_memory_gb <= 24
    error_message = "Memory must be between 6 and 24 GB. The Always Free A1 allowance is 24 GB across the whole tenancy."
  }
}

variable "boot_volume_gb" {
  description = "Boot volume size. Always Free block storage is 200 GB in total; 100 GB leaves half the entitlement free."
  type        = number
  default     = 100

  validation {
    condition     = var.boot_volume_gb >= 50 && var.boot_volume_gb <= 150
    error_message = "Boot volume must be between 50 and 150 GB. The Always Free block storage entitlement is 200 GB in total and boot volumes count against it."
  }
}

# ── Required inputs ─────────────────────────────────────────────────────────

variable "compartment_ocid" {
  description = "Compartment to create resources in. The tenancy root OCID is acceptable for a personal account."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.(compartment|tenancy)\\.", var.compartment_ocid))
    error_message = "Must be a compartment or tenancy OCID beginning with ocid1.compartment. or ocid1.tenancy."
  }
}

variable "ssh_public_key" {
  description = "Contents of the ed25519 public key authorised for the ubuntu user. The public key only — never the private key."
  type        = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa) ", trimspace(var.ssh_public_key)))
    error_message = "Must be an OpenSSH public key starting with ssh-ed25519 or ssh-rsa."
  }

  validation {
    condition     = !can(regex("PRIVATE KEY", var.ssh_public_key))
    error_message = "That looks like a PRIVATE key. Supply the .pub file contents only."
  }
}

variable "admin_ipv4_cidrs" {
  description = "Source CIDRs allowed to reach SSH. Defaulting to the whole Internet would leave port 22 globally exposed on a host that runs autonomous code, so this must be set explicitly."
  type        = list(string)

  validation {
    condition     = length(var.admin_ipv4_cidrs) > 0 && !contains(var.admin_ipv4_cidrs, "0.0.0.0/0")
    error_message = "Set at least one specific admin CIDR. 0.0.0.0/0 is rejected: SSH must not be open to the Internet."
  }
}

# ── Optional ────────────────────────────────────────────────────────────────

variable "availability_domain" {
  description = "Availability domain name. Leave empty to use the first AD in the region. A1 capacity varies by AD, so an explicit value helps when the first one is full."
  type        = string
  default     = ""
}

variable "name_prefix" {
  description = "Prefix applied to created resources."
  type        = string
  default     = "aira-deerflow"
}

variable "vcn_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}
