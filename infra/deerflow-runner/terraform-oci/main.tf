# AIRA DeerFlow host on Oracle Cloud Always Free.
#
# Creates only resources that fall inside the Always Free allowance: one Ampere
# A1 ARM64 instance, a VCN with a public subnet and an Internet Gateway, and a
# security list. Everything DeerFlow needs that would otherwise be a paid managed
# service — PostgreSQL, Redis, the sandbox runtime — runs on the instance itself.
#
# Deliberately NOT created, because each is billable:
#   - NAT Gateway (the public subnet + Internet Gateway serves egress instead)
#   - Load Balancer (Caddy on the instance terminates TLS)
#   - OCI Autonomous Database or any managed database
#   - OKE managed Kubernetes (k3s runs on the instance)
#   - Block volumes beyond the boot volume
#
# Always Free eligibility is asserted by the variable validations, but those are
# a guardrail, not proof. Confirm against the live account after apply — see
# README.md, "Verifying $0".

locals {
  ad_name = var.availability_domain != "" ? var.availability_domain : data.oci_identity_availability_domains.ads.availability_domains[0].name
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

# Resolve the newest Canonical Ubuntu 24.04 aarch64 image rather than pinning a
# stale OCID. Oracle republishes these images regularly and an OCID hard-coded
# today stops being resolvable.
data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# ── Network ─────────────────────────────────────────────────────────────────
resource "oci_core_vcn" "deerflow" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${var.name_prefix}-vcn"
  dns_label      = "airadf"
}

resource "oci_core_internet_gateway" "deerflow" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.deerflow.id
  display_name   = "${var.name_prefix}-igw"
  enabled        = true
}

resource "oci_core_route_table" "deerflow" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.deerflow.id
  display_name   = "${var.name_prefix}-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.deerflow.id
  }
}

# Public ingress is 80 and 443 only, plus SSH from the admin CIDRs. The Gateway
# (8001), nginx's published port (2026), Redis (6379), PostgreSQL (5432) and the
# k3s API (6443/26443) are never opened: they bind to loopback or the container
# network, and Caddy reaches them from on-host.
resource "oci_core_security_list" "deerflow" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.deerflow.id
  display_name   = "${var.name_prefix}-sl"

  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
  }

  dynamic "ingress_security_rules" {
    for_each = var.admin_ipv4_cidrs
    content {
      protocol = "6" # TCP
      source   = ingress_security_rules.value
      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_subnet" "deerflow" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.deerflow.id
  cidr_block                 = var.subnet_cidr
  display_name               = "${var.name_prefix}-subnet"
  dns_label                  = "airadfsub"
  route_table_id             = oci_core_route_table.deerflow.id
  security_list_ids          = [oci_core_security_list.deerflow.id]
  prohibit_public_ip_on_vnic = false
}

# ── Compute ─────────────────────────────────────────────────────────────────
resource "oci_core_instance" "deerflow" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.ad_name
  display_name        = "${var.name_prefix}-host"
  shape               = var.shape

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.deerflow.id
    assign_public_ip = true
    hostname_label   = "deerflow"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  # A1 capacity is frequently exhausted in a given AD. Terraform surfaces
  # Oracle's "Out of host capacity" error directly; retry in another AD or later
  # rather than switching to a billable shape.
  lifecycle {
    # The instance carries DEER_FLOW_HOME, the PostgreSQL data directory and k3s
    # state. Replacing it destroys all of them.
    prevent_destroy = true

    precondition {
      condition     = length(data.oci_core_images.ubuntu_arm.images) > 0
      error_message = "No Canonical Ubuntu 24.04 aarch64 image was found for VM.Standard.A1.Flex in this region. Check the compartment OCID and the region in ~/.oci/config."
    }
  }
}
