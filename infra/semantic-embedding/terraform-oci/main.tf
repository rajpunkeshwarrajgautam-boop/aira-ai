locals {
  ad_name = var.availability_domain != "" ? var.availability_domain : data.oci_identity_availability_domains.ads.availability_domains[0].name
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "embedding" {
  compartment_id = var.compartment_ocid
  cidr_blocks     = [var.vcn_cidr]
  display_name    = "${var.name_prefix}-vcn"
  dns_label       = "airasem"
}

resource "oci_core_internet_gateway" "embedding" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.embedding.id
  display_name   = "${var.name_prefix}-igw"
  enabled        = true
}

resource "oci_core_route_table" "embedding" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.embedding.id
  display_name   = "${var.name_prefix}-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.embedding.id
  }
}

resource "oci_core_security_list" "embedding" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.embedding.id
  display_name   = "${var.name_prefix}-sl"

  egress_security_rules {
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    protocol         = "all"
  }

  dynamic "ingress_security_rules" {
    for_each = var.admin_ipv4_cidrs
    content {
      protocol = "6"
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

resource "oci_core_subnet" "embedding" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.embedding.id
  cidr_block                 = var.subnet_cidr
  display_name               = "${var.name_prefix}-subnet"
  dns_label                  = "airasemsub"
  route_table_id             = oci_core_route_table.embedding.id
  security_list_ids          = [oci_core_security_list.embedding.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "embedding" {
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
    subnet_id        = oci_core_subnet.embedding.id
    assign_public_ip = true
    hostname_label   = "semanticembed"
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  lifecycle {
    # The model/runtime is reproducible, but accidental instance destruction also
    # loses its public IP and can silently break Vercel's configured endpoint.
    prevent_destroy = true

    precondition {
      condition     = length(data.oci_core_images.ubuntu_arm.images) > 0
      error_message = "No Canonical Ubuntu 24.04 ARM image was found for VM.Standard.A1.Flex in this region. Verify the tenancy home region and compartment."
    }
  }
}
