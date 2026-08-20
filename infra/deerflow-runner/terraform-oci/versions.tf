terraform {
  required_version = ">= 1.6.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.20"
    }
  }
}

# Authenticate through the standard ~/.oci/config file, or the OCI_* environment
# variables. Credentials are deliberately not Terraform variables: that keeps the
# API key, fingerprint and tenancy OCID out of tfvars, plan output and state.
provider "oci" {}
