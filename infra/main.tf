terraform {
  required_version = ">= 1.6.0"
}

locals {
  generated_dir = "${path.module}/.generated"

  rendered_startup = {
    for key, instance in var.openclaw_instances :
    key => "${local.generated_dir}/${key}/setup-openclaw.rendered.sh"
  }

  startup_response = {
    for key, instance in var.openclaw_instances :
    key => "${local.generated_dir}/${key}/startup-script.json"
  }

  vm_response = {
    for key, instance in var.openclaw_instances :
    key => "${local.generated_dir}/${key}/vm.json"
  }

  startup_script_id = {
    for key, path in local.startup_response :
    key => trimspace(try(jsondecode(file(path)).id, ""))
  }

  vm_id = {
    for key, path in local.vm_response :
    key => trimspace(try(jsondecode(file(path)).id, ""))
  }

  vm_ip = {
    for key, path in local.vm_response :
    key => trimspace(try(jsondecode(file(path)).ip, ""))
  }
}

resource "terraform_data" "render_startup_script" {
  for_each = var.openclaw_instances

  input = {
    key                    = each.key
    deepseek_api_key       = var.deepseek_api_key
    openclaw_gateway_token = var.openclaw_gateway_token
    openclaw_port          = each.value.openclaw_port
  }

  provisioner "local-exec" {
    command = <<-SH
      set -eu
      mkdir -p "${local.generated_dir}/${each.key}"
      sed \
        -e 's|__DEEPSEEK_API_KEY__|${var.deepseek_api_key}|g' \
        -e 's|__OPENCLAW_GATEWAY_TOKEN__|${var.openclaw_gateway_token}|g' \
        -e 's|__OPENCLAW_PORT__|${each.value.openclaw_port}|g' \
        "${path.module}/setup-openclaw.sh" > "${local.rendered_startup[each.key]}"
      chmod 700 "${local.rendered_startup[each.key]}"
    SH
  }
}

resource "terraform_data" "startup_script" {
  for_each   = var.openclaw_instances
  depends_on = [terraform_data.render_startup_script]

  input = {
    name = "${each.value.name}-setup-openclaw"
    file = local.rendered_startup[each.key]
  }

  provisioner "local-exec" {
    command = <<-SH
      set -eu
      verda startup-script add \
        --agent \
        --output json \
        --name "${each.value.name}-setup-openclaw" \
        --file "${local.rendered_startup[each.key]}" > "${local.startup_response[each.key]}"
    SH
  }
}

resource "terraform_data" "vm" {
  for_each   = var.openclaw_instances
  depends_on = [terraform_data.startup_script]

  input = {
    hostname          = each.value.name
    location          = each.value.location
    kind              = each.value.kind
    instance_type     = each.value.instance_type
    os                = each.value.os
    os_volume_size    = each.value.os_volume_size
    ssh_key_ids       = join(",", each.value.ssh_key_ids)
    startup_script_id = local.startup_script_id[each.key]
  }

  provisioner "local-exec" {
    command = <<-SH
      set -eu
      if [ -z "${local.startup_script_id[each.key]}" ]; then
        echo "startup script id missing in ${local.startup_response[each.key]}" >&2
        exit 1
      fi
      verda vm create \
        --agent \
        --output json \
        --kind "${each.value.kind}" \
        --instance-type "${each.value.instance_type}" \
        --location "${each.value.location}" \
        --os "${each.value.os}" \
        --os-volume-size "${each.value.os_volume_size}" \
        --hostname "${each.value.name}" \
        --description "${each.value.description}" \
        --startup-script "${local.startup_script_id[each.key]}" \
        ${join(" ", [for id in each.value.ssh_key_ids : "--ssh-key ${id}"])} \
        --wait > "${local.vm_response[each.key]}"
    SH
  }
}
