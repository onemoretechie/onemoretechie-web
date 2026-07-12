---
title: Terraform at Scale — Modules, Workspaces, and Remote State
description: The three decisions that make or break a Terraform codebase past one team. What workspaces are actually for (and what they aren't), how to organise modules that survive refactors, and remote-state patterns that don't corrupt.
pubDate: 2026-07-05
topic: iac-kubernetes
type: architecture-doc
tags: [terraform, iac, workspaces, remote-state, modules, terraform-cloud, s3-backend]
github_repo: https://github.com/onemoretechie/aws-infrastructure-as-code
draft: false
---

Terraform is deceptively easy to start with and painful to scale. Two months in, you have a `main.tf` and an S3 backend and everything works. Two years in, you have 40 modules, 12 workspaces you're not sure the purpose of, a state file nobody wants to touch, and a Friday-afternoon `terraform apply` that everyone dreads.

This post is the three architectural decisions that determine whether your Terraform codebase is a source of leverage or a source of incidents: **how you organise modules, what you actually use workspaces for, and how you manage remote state across a team.** Get these right early and the rest of the tooling — CI, review flow, testing — falls into place. Get them wrong and no amount of Terragrunt will save you.

> **TL;DR.** Prefer **directory-per-environment** over Terraform workspaces (HashiCorp's own docs recommend this). Structure modules by **stable service boundaries** (`vpc`, `eks-cluster`, not `prod-us-east-1`). Use **S3 + DynamoDB backend with a locked state per environment**, one state file per unit that can be applied independently. State-file sprawl is worse than state-file monoliths.

## Where Terraform breaks at scale

The failure modes are consistent across every org I've seen scale past ~3 engineers:

- **State-file monoliths** — one state file for everything, a 45-minute plan, a single lock that blocks everyone.
- **State-file sprawl** — 200 state files, no consistent naming, nobody knows which one contains what.
- **Copy-pasted "modules"** — subdirectories named `module` that are actually 800-line configurations with 12 hardcoded assumptions.
- **Workspace confusion** — `terraform workspace list` returns `dev`, `staging`, `prod`, `bob-testing`, `old-prod-do-not-delete`, and the codebase has `count = terraform.workspace == "prod" ? 3 : 1` scattered throughout.
- **Refactor paralysis** — resources need to move to a different module, but `terraform state mv` scares everyone, so the module grows a bit more instead.

Each one has a specific architectural cause. Let's take them in order.

## Decision 1 — Module organisation

The single most important structural decision: what constitutes a module.

**Wrong:** modules organised by environment or region.
```
modules/
├── prod-us-east-1/
├── prod-eu-west-2/
├── staging-us-east-1/
└── dev-us-east-1/
```
This is a copy-paste factory. Any change requires updating N similar directories.

**Right:** modules organised by **stable service boundaries**.
```
modules/
├── network/          # VPC, subnets, route tables, TGW attachments
├── eks-cluster/      # EKS + node groups + IRSA + core add-ons
├── rds-postgres/     # PostgreSQL instance + parameter group + backup config
├── s3-encrypted/     # Encrypted-by-default bucket with lifecycle policies
├── alb-with-waf/     # Application load balancer with WAF association
└── observability/    # CloudWatch dashboards + alarms + log groups
```

Each module has one clear responsibility, versioned inputs, versioned outputs, and can be consumed by any environment.

**The three rules for a good module:**

1. **Inputs describe *what*, not *how much*.** `instance_type = "m6g.large"` is fine; `create_high_availability_setup = true` is a code smell — that flag branches internal logic in ways future-you will not understand.
2. **Outputs are stable across versions.** Rename an output, break every consumer.
3. **A module owns exactly one state file's worth of resources.** If you can't reason about the module's blast radius in your head, it's too big.

Bad modules smell like: too many inputs (>20), boolean feature flags controlling large branches of resources, or outputs that reference internal implementation details.

## Decision 2 — Workspaces (and what they aren't for)

**Terraform workspaces are one of the most misused features in the tool.** HashiCorp's own documentation says:

> "In particular, organizations commonly want to create a strong separation between multiple deployments of the same infrastructure serving different development stages... In this case, the backend used for each deployment often belongs to that deployment... **Workspaces alone are not a suitable tool for system decomposition, because each subsystem should have its own separate configuration and backend.**"

Translation: **do not use workspaces to separate `dev`, `staging`, and `prod`.**

**What workspaces *are* for:**
- Short-lived branch environments (spin up a feature-branch stack, tear it down when the PR merges)
- Testing module changes against an existing state (rare)

**What to use instead of workspaces for environments:** directory-per-environment.

```
environments/
├── dev/
│   ├── main.tf          # calls modules with dev inputs
│   ├── backend.tf       # dev-specific S3 backend
│   └── terraform.tfvars # dev variable values
├── staging/
│   ├── main.tf
│   ├── backend.tf
│   └── terraform.tfvars
└── prod/
    ├── main.tf
    ├── backend.tf
    └── terraform.tfvars
```

Each environment is a separate root module with its own backend, its own state, its own IAM role for provisioning. **A misconfigured `terraform apply` in dev cannot touch prod state.** Compare that to workspaces, where `terraform workspace select` typos have caused real incidents.

The trade-off: some duplication across environment directories. Solve it by keeping the environment root modules *thin* — they mostly just call shared modules with different inputs. If you find yourself copying resource definitions across environments, promote those to a module.

## Decision 3 — Remote state architecture

State is where the actual damage happens. Two failure modes:

**Monolith state:**
```
one-state-file/
└── everything: VPCs, EKS, RDS, DNS, IAM, S3, ALBs, monitoring...
```
- Plan takes 20+ minutes
- Any change locks the entire estate
- A `terraform destroy` typo destroys everything

**Sprawl state:**
```
too-many-state-files/
├── vpc-a.tfstate
├── vpc-a-subnets.tfstate
├── vpc-a-eks.tfstate
├── vpc-a-eks-monitoring.tfstate
└── ... (200 more)
```
- Cross-state data lookups everywhere (`terraform_remote_state` in every module)
- Nobody knows which state file to look in
- Circular dependencies between states

**The right granularity: one state per unit that can be applied independently.**

A useful rule: a state file's contents should be things that are **deployed together, destroyed together, and owned by the same team**. Typical scale:

```
state-files-per-environment/
├── network.tfstate          # VPCs, TGW, route tables — foundational, changes rarely
├── platform.tfstate         # EKS, RDS, S3, shared infra — changes monthly
├── app-checkout.tfstate     # checkout service infra — changes weekly per team
├── app-inventory.tfstate    # inventory service infra
└── observability.tfstate    # dashboards, alarms — changes with product features
```

Six state files per environment, three environments, 18 total. Manageable. Each has a clear owner. Cross-state references are explicit and few.

### The S3 + DynamoDB backend done right

```hcl
# environments/prod/backend.tf
terraform {
  backend "s3" {
    bucket         = "my-org-tfstate-prod"
    key            = "platform/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "tfstate-lock-prod"
    encrypt        = true
  }
}
```

Then provision that infrastructure with a **bootstrap** Terraform config that lives outside the main state (chicken-and-egg — the state bucket can't be in the state it stores):

```hcl
# bootstrap/main.tf — apply once, then never again
resource "aws_s3_bucket" "tfstate" {
  bucket = "my-org-tfstate-prod"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"  # critical — enables state rollback via S3 version history
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "tfstate-lock-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}
```

The three non-negotiable settings: **versioning on the bucket** (rollback path), **encryption** (state files contain secrets — passwords, tokens), and **DynamoDB locking** (concurrent applies are how you corrupt state).

### Cross-state data via `terraform_remote_state`

When one state file needs data from another:

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "my-org-tfstate-prod"
    key    = "network/terraform.tfstate"
    region = "eu-west-2"
  }
}

resource "aws_eks_cluster" "app" {
  vpc_config {
    subnet_ids = data.terraform_remote_state.network.outputs.private_subnet_ids
  }
}
```

Two rules:

1. **Only reference explicit `outputs`.** If you need something not exposed as an output, add the output to the source module. Don't dig into internal resources.
2. **Cross-state references are read-only.** The consuming state cannot modify the producing state. If you need bidirectional coupling, the two components probably belong in the same state file.

## Terraform Cloud / Enterprise vs OSS + S3

The recurring question: do we upgrade to Terraform Cloud?

| Feature | OSS + S3 backend | Terraform Cloud |
|---|---|---|
| State storage | S3 (encrypted, versioned) | Managed |
| State locking | DynamoDB | Managed |
| Run history | You DIY (CI logs) | Built-in UI |
| Approval workflow | You DIY (PR review + CI gates) | Built-in |
| Cost | $0 for state; CI runs use your infra | Priced per user/apply |
| Sentinel / policy-as-code | You DIY (OPA, tflint) | Built-in |
| Private module registry | You DIY (Git repos) | Built-in |

**OSS + S3 is fine up to ~15 engineers.** The DIY parts are all cheap: GitHub Actions runs Terraform, PR review is your approval, tflint + checkov + tfsec run in CI.

**Terraform Cloud earns its keep at ~30+ engineers,** or when you have regulatory/audit requirements that need a formal run history, or when you want Sentinel policies enforced *before* apply rather than *during* CI.

Terragrunt is a third option — DRY layer over OSS Terraform, popular in orgs that live in OSS but want to reduce boilerplate. It's a valid choice but adds a tool to the stack. Only reach for it if the boilerplate is provably hurting you.

## The workflow that actually works

Concrete team workflow with OSS + S3 + GitHub Actions:

1. **Developer writes changes** in a feature branch under `environments/dev/`
2. **PR opens** — GitHub Actions runs `terraform fmt -check`, `terraform validate`, `terraform plan` on the changed environment
3. **Plan output posted as PR comment** — reviewer sees the exact diff before approval
4. **Merge to `main`** triggers `terraform apply` on the target environment via a role assumed with OIDC (no long-lived AWS keys in CI)
5. **State lock during apply** (DynamoDB) — parallel merges queue
6. **Promotion to staging / prod** is a separate PR against those environment directories, requiring additional review

Two important CI details:

- **OIDC federation** — GitHub Actions authenticates to AWS via a role assumption using workload identity, not stored credentials. Rotate the trust policy, not a secret.
- **Plan on PR, apply on merge** — never `apply` from a feature branch. Ever. This is the single most important rule; ignore it and eventually you'll `apply` an unreviewed plan into production.

## Refactoring — the moves nobody teaches

Modules grow. Eventually you need to split one, rename one, move resources between them. The three commands:

```bash
# Move a resource within the same state
terraform state mv 'aws_s3_bucket.old_name' 'aws_s3_bucket.new_name'

# Move a resource between states (before Terraform 1.5)
terraform state pull > src.tfstate
# manually edit + terraform state push to destination — DANGEROUS, backup first

# Import an existing resource you didn't create
terraform import 'aws_s3_bucket.imported' 'existing-bucket-name'
```

**Since Terraform 1.5:** `moved` blocks in HCL let you rename/refactor resources declaratively:

```hcl
moved {
  from = aws_s3_bucket.old_name
  to   = aws_s3_bucket.new_name
}
```

`terraform apply` sees the `moved` block and updates state without recreating the resource. This is the safe pattern for module refactors. Use it.

**Since Terraform 1.7:** `removed` blocks let you remove a resource from state without destroying the underlying infrastructure. Useful when you're transferring ownership of a resource to another state file or to a different team.

## Trade-offs to be honest about

| If you pick | You give up |
|---|---|
| **Directory-per-environment** | Some code duplication. Mitigated by thin environment roots + shared modules. |
| **Multiple small state files** | Cross-state coupling via `terraform_remote_state`. Requires discipline on outputs. |
| **OSS + S3 over Terraform Cloud** | Approval workflow + run history you build yourself. Cheaper but more moving parts. |
| **Terragrunt** | A learning curve for every new hire. Only worth it if the boilerplate is real. |
| **`moved` blocks over `terraform state mv`** | Cluttered HCL files if you leave old `moved` blocks around forever. Cleanup periodically. |

## Production-readiness checklist

Before declaring your Terraform practice mature:

- [ ] State bucket has versioning + encryption + public access blocked
- [ ] DynamoDB locking table exists per backend
- [ ] Environment separation is directory-per-environment, not workspaces
- [ ] Modules organised by service boundary, not by environment or region
- [ ] No module has >20 input variables (if it does, split it)
- [ ] `terraform fmt` and `terraform validate` run in CI on every PR
- [ ] Static analysis (tflint + tfsec + checkov) runs in CI
- [ ] Plan output posted as PR comment for review
- [ ] Apply runs via OIDC-federated role, no long-lived keys
- [ ] Rollback path documented — via `terraform apply` of previous commit + S3 state version restore if needed
- [ ] Bootstrap infra (state bucket, lock table) has its own README and is applied once
- [ ] Drift detection runs weekly (`terraform plan` on schedule, alerts on non-empty diffs)

## Where to start if you're inheriting a mess

The most common state you'll walk into: workspaces used for environments, one big monolith state file, no locking, and terraform apply from a developer's laptop.

Order of operations:

1. **Enable S3 versioning on the state bucket + DynamoDB locking.** (Half a day.)
2. **Move `terraform apply` off developer laptops into CI.** OIDC + GitHub Actions. (One day.)
3. **Add PR-comment plan output.** (One day.)
4. **Add tflint + tfsec to CI.** (One day.)
5. **Split the monolith state** — start with the least-changing subsystem (usually network). Use `terraform state mv` or Terraform 1.7+ `removed` + re-import to relocate resources. (One week per split.)
6. **Migrate from workspaces to directory-per-environment** — start by creating the new directory structure alongside the workspaces, migrate one environment at a time. Delete workspaces last. (Two weeks.)

Steps 1-4 are cheap and safe and immediately raise the quality floor. Steps 5-6 are riskier and slower but worth it in the long run.

## Companion code

The exact patterns above — S3 backend bootstrap, module structure, environment root templates, GitHub Actions with OIDC — live in [`onemoretechie/aws-infrastructure-as-code`](https://github.com/onemoretechie/aws-infrastructure-as-code) under `examples/terraform-at-scale/`.

## Related reading

- [Terraform official recommendations on workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces) — read the "When Not To Use Multiple Workspaces" section
- [Terraform S3 backend docs](https://developer.hashicorp.com/terraform/language/settings/backends/s3)
- [Terraform 1.5 `moved` blocks](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [IAM at Scale](/blog/iam-at-scale/) — Terraform's OIDC federation for CI ties directly into this
- [Multi-Region Architecture](/blog/multi-region-failover/) — one of the reasons to split state per region
