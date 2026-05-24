variable "openclaw_instances" {
  type = map(object({
    name           = string
    description    = string
    founder_email  = string
    location       = optional(string, "FIN-01")
    kind           = optional(string, "cpu")
    instance_type  = optional(string, "CPU.4V.16G")
    os             = optional(string, "ubuntu-24.04")
    os_volume_size = optional(number, 80)
    ssh_key_ids    = list(string)
    openclaw_port  = optional(number, 18789)
  }))
  description = "OpenClaw VM instances keyed by routing name. Add one entry per founder-scoped VM."
}

variable "openclaw_gateway_token" {
  type        = string
  description = "Bearer token expected by the app proxy when calling OpenClaw."
  sensitive   = true
}

variable "deepseek_api_key" {
  type        = string
  description = "DeepSeek API key for the OpenClaw provider."
  sensitive   = true
}
