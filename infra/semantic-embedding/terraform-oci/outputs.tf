output "instance_id" {
  value       = oci_core_instance.embedding.id
  description = "OCI instance OCID."
}

output "public_ip" {
  value       = oci_core_instance.embedding.public_ip
  description = "Public IPv4 address. Point the AIRA-controlled embedding hostname here before running bootstrap-host.sh."
}

output "ssh_command" {
  value       = "ssh ubuntu@${oci_core_instance.embedding.public_ip}"
  description = "Operator SSH command. Network policy still restricts port 22 to admin_ipv4_cidrs."
}
