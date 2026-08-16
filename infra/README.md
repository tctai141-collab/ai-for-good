# Sprint Buddy Infrastructure

> **⚠️ Obsolete — kept for reference only.**
>
> This Terraform provisions OpenClaw advisor VMs, which the app no longer uses:
> the advisor calls the Anthropic API directly (`src/lib/ai.ts`). Nothing here
> needs to be applied to run Sprint Buddy. See the README at the repository root.

Terraform here provisions OpenClaw VMs through the Verda CLI. The default
configuration creates a shared instance plus a second instance tied to
`founder2@sprint.test`.

This uses `terraform_data` resources with `local-exec` because this repo has the
Verda CLI available, but no pinned Verda Terraform provider. The flow is still
declarative enough for repeatable hackathon/demo infrastructure:

1. Render `setup-openclaw.sh` from Terraform variables.
2. Register the rendered script as a Verda startup script.
3. Create one VM per `openclaw_instances` entry.
4. Save Verda JSON responses under `infra/.generated/`.

## Prerequisites

- `terraform`
- `verda` CLI authenticated locally
- SSH key already registered in Verda

## Usage

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Set sensitive values with environment variables or `terraform.tfvars`:

```sh
export TF_VAR_deepseek_api_key="sk-..."
export TF_VAR_openclaw_gateway_token="replace-with-gateway-token"
```

After apply, copy the `app_env` output into the Astro runtime. The app proxy
uses:

- `OPENCLAW_URL` for the default/shared OpenClaw instance.
- `OPENCLAW_URL_FOUNDER2` for `founder2@sprint.test`.

Add more founder-specific instances by adding entries to
`openclaw_instances` and extending the app proxy routing map.

## Advisor Corpora

`docs/advisors/` is the single committed advisor corpus location. Keep only
processed, clean, submission-safe text there. After the VM is up, copy advisor
materials to:

```text
/opt/openclaw/.openclaw/workspace/memory/advisors/
```

Then SSH into the VM and run:

```sh
env HOME=/opt/openclaw \
  OPENCLAW_CONFIG_PATH=/opt/openclaw/.openclaw/openclaw.json \
  /opt/openclaw/bin/openclaw memory index --force
```

The setup script also flattens known advisor corpora into:

- `memory/advisor-marten-mickos.md`
- `memory/advisor-paul-graham.md`

## Notes

Destroy currently removes only Terraform-local generated files. VM deletion is
left manual because the CLI output schema can vary and accidental VM deletion is
too expensive for this repo automation.
