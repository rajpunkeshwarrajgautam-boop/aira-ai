output "instance_public_ip" {
  description = "Public IPv4. Point the DeerFlow hostname's A record here, and use it for SSH."
  value       = oci_core_instance.deerflow.public_ip
}

output "instance_private_ip" {
  value = oci_core_instance.deerflow.private_ip
}

output "instance_ocid" {
  value = oci_core_instance.deerflow.id
}

output "availability_domain" {
  value = oci_core_instance.deerflow.availability_domain
}

output "resolved_image_id" {
  description = "The Ubuntu 24.04 aarch64 image actually selected, for the record."
  value       = data.oci_core_images.ubuntu_arm.images[0].id
}

# Echoed back so the applied footprint can be compared against the Always Free
# allowance without reading the plan again.
output "always_free_footprint" {
  description = "What was actually built. Verify against the live account before claiming $0."
  value = {
    shape          = oci_core_instance.deerflow.shape
    ocpus          = var.instance_ocpus
    memory_gb      = var.instance_memory_gb
    boot_volume_gb = var.boot_volume_gb
    a1_pool_note   = "Always Free A1 pool is 4 OCPU / 24 GB in total across the tenancy."
    storage_note   = "Always Free block storage is 200 GB in total; boot volumes count."
    billable_note  = "No NAT Gateway, Load Balancer, managed database or OKE cluster is created by this module."
  }
}

output "ssh_command" {
  description = "Convenience: how to reach the host once it boots."
  value       = "ssh ubuntu@${oci_core_instance.deerflow.public_ip}"
}
