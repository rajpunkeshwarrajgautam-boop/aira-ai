variable "shape" {
  description = "Compute shape. Locked to OCI Always Free Ampere A1."
  type        = string
  default     = "VM.Standard.A1.Flex"

  validation {
    condition     = var.shape == "VM.Standard.A1.Flex"
    error_message = "Only VM.Standard.A1.Flex is allowed. Do not silently switch this module to a billable shape."
  }
}

variable "instance_ocpus" {
  description = "OCPUs for the embedding host. Default 1 leaves half of the currently documented 2-OCPU Always Free A1 allowance available."
  type        = number
  default     = 1

  validation {
    condition     = var.instance_ocpus >= 1 && var.instance_ocpus <= 2 && floor(var.instance_ocpus) == var.instance_ocpus
    error_message = "instance_ocpus must be an integer from 1 to 2."
  }
}

variable "instance_memory_gb" {
  description = "RAM in GB. Stay at or below 6 GB per configured OCPU to remain within the current 2-OCPU/12-GB Always Free A1 equivalent."
  type        = number
  default     = 6

  validation {
    condition     = var.instance_memory_gb >= 1 && var.instance_memory_gb <= 12
    error_message = "instance_memory_gb must be between 1 and 12 GB."
  }
}

variable "boot_volume_gb" {
  description = "Boot volume size. 50 GB is the default/minimum practical size and counts against the tenancy's Always Free block-storage pool."
  type        = number
  default     = 50

  validation {
    condition     = var.boot_volume_gb >= 50 && var.boot_volume_gb <= 100
    error_message = "boot_volume_gb must be between 50 and 100 GB. Verify total tenancy block-storage usage before apply."
  }
}

variable "compartment_ocid" {
  description = "Compartment in the tenancy home region. The tenancy root OCID is acceptable for a personal account."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.(compartment|tenancy)\\.", var.compartment_ocid))
    error_message = "Must be a compartment or tenancy OCID."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key authorised for the ubuntu operator account. Never provide a private key."
  type        = string

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa) ", trimspace(var.ssh_public_key)))
    error_message = "Must start with ssh-ed25519 or ssh-rsa."
  }

  validation {
    condition     = !can(regex("PRIVATE KEY", var.ssh_public_key))
    error_message = "A private key was supplied. Use the .pub file only."
  }
}

variable "admin_ipv4_cidrs" {
  description = "Specific IPv4 CIDRs allowed to SSH. Global SSH ingress is rejected."
  type        = list(string)

  validation {
    condition     = length(var.admin_ipv4_cidrs) > 0 && !contains(var.admin_ipv4_cidrs, "0.0.0.0/0")
    error_message = "Provide at least one specific admin CIDR; 0.0.0.0/0 is not allowed for SSH."
  }
}

variable "availability_domain" {
  description = "Optional availability-domain name. Leave empty for the first AD; specify another AD if A1 capacity is exhausted."
  type        = string
  default     = ""
}

variable "name_prefix" {
  type    = string
  default = "aira-semantic-embed"
}

variable "vcn_cidr" {
  type    = string
  default = "10.31.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.31.1.0/24"
}
