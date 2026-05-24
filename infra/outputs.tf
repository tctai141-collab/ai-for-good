output "instances" {
  value = {
    for key, instance in var.openclaw_instances :
    key => {
      founder_email        = instance.founder_email
      vm_id                = local.vm_id[key]
      vm_ip                = local.vm_ip[key]
      openclaw_gateway_url = local.vm_ip[key] == "" ? "" : "http://${local.vm_ip[key]}:${instance.openclaw_port}/v1/chat/completions"
      startup_script_id    = local.startup_script_id[key]
    }
  }
  description = "OpenClaw instances keyed by routing name."
}

output "app_env" {
  value = {
    OPENCLAW_URL          = try("http://${local.vm_ip["default"]}:${var.openclaw_instances["default"].openclaw_port}/v1/chat/completions", "")
    OPENCLAW_URL_FOUNDER2 = try("http://${local.vm_ip["founder2"]}:${var.openclaw_instances["founder2"].openclaw_port}/v1/chat/completions", "")
  }
  description = "Environment variables to copy into the Astro app runtime."
}
