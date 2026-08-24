terraform {
  required_version = ">= 1.6.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.20"
    }
  }
}

# Authenticate through the standard ~/.oci/config file or supported OCI_*
# environment variables. API credentials are intentionally not Terraform
# variables so private keys/fingerprints do not enter tfvars or Terraform state.
provider "oci" {}
