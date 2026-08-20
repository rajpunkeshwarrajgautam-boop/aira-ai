terraform {
  required_version = ">= 1.6.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.43"
    }
  }
}

# Authenticate with the DIGITALOCEAN_TOKEN environment variable. The token is
# deliberately not a Terraform variable: keeping it out of the variable set keeps
# it out of tfvars files, the plan output and the state file.
provider "digitalocean" {}
