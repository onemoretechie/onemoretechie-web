---
title: IAM at Scale — SSO, SCPs, and Permission Boundaries
description: What "least privilege" actually looks like across a multi-account AWS org. The four control planes that matter, where each one bites, and the growth path from small team to enterprise.
pubDate: 2026-07-05
topic: security
type: architecture-doc
tags: [iam, identity-center, scp, permission-boundaries, aws-organizations, abac, least-privilege]
github_repo: https://github.com/onemoretechie/aws-infrastructure-as-code
draft: false
---

IAM is the AWS service most teams outgrow without realising. It scales fine for one account with five engineers; it becomes a source of constant incidents by the time you have twenty accounts and fifty engineers. The failure mode is always the same: individual IAM policies proliferate, nobody wants to touch them because breaking someone's access is career-limiting, and the org quietly drifts into a state where "who can do what" is unknowable.

This post is the version I wish I'd had before running an IAM cleanup at scale — the four control planes that actually enforce least privilege, where each one bites, and a growth ladder that gets you from "one account, IAM users" to "twenty accounts, federated SSO, SCP guardrails" without a rewrite.

> **TL;DR.** The four IAM control planes at scale are **Identity Center** (who you are), **IAM roles + policies** (what you can do in an account), **SCPs** (what nobody can do in a whole org), and **Permission Boundaries** (what a delegated role-creator can grant). Get all four right and access reviews become boring — which is the goal.

## The identity mess most orgs are in

A three-year-old AWS setup that grew organically usually looks like this:

- 8-15 accounts, connected by nothing except a spreadsheet
- IAM users in each account, some shared with the same email
- Long-lived access keys in `~/.aws/credentials` files, rarely rotated
- A "prod-admin" role that six people can assume, with `*:*` on `Resource: *`
- Terraform state stored in S3 buckets accessed via `AdministratorAccess`
- Nobody knows exactly who has what access

The team knows this is bad. The team also knows that fixing it means potentially breaking every automation, every developer's workflow, and every deploy pipeline. So it doesn't get fixed. Then a security auditor asks who has production access, and the answer takes two weeks to compile.

## The four control planes

Modern AWS IAM at scale isn't one thing — it's four systems that work together. Understanding what each one does (and doesn't do) is the difference between a coherent posture and duct tape.

### 1. AWS IAM Identity Center — the front door

IAM Identity Center (formerly AWS SSO) is where humans authenticate once and get short-lived credentials across all accounts. If you're using IAM users in 2026, you're leaving the party.

**What it does:**
- Federates identity from your IdP of choice (Okta, Entra ID, Google Workspace, or Identity Center's built-in directory)
- Assigns **permission sets** — reusable policy templates — to users/groups across accounts
- Issues short-lived STS credentials on demand (session lifetime configurable up to 12 hours)
- Zero long-lived credentials in `~/.aws/`

**What it doesn't do:**
- It doesn't give you fine-grained per-service policies. Permission sets contain IAM policies just like any role, so bad policies in Identity Center are still bad policies.
- It doesn't work well for machine identity — use IAM roles for that.

```bash
# Configure the AWS CLI to use Identity Center — one-time
aws configure sso
# → Opens browser, authenticates, writes ~/.aws/config with `sso_session` blocks

# Then use profiles per account
aws s3 ls --profile prod-readonly
aws s3 ls --profile dev-admin

# STS credentials auto-refresh; sso login extends the session
aws sso login --sso-session my-org
```

Identity Center is the single highest-leverage IAM investment for any org above ~5 engineers. Set it up before doing anything else.

### 2. IAM roles + policies — what happens inside an account

Once identity is federated, the question becomes: what can that identity *do* in a given account? This is where IAM roles and policies live, and it's the layer everyone already thinks of when they hear "IAM."

The scale trap: teams write custom inline policies per role. After a year, you have 300 policies, each slightly different, and nobody can answer "who can write to bucket X." The fix:

- **Managed policies over inline policies.** Version-controlled, reusable, revocable.
- **Job-function policies as the starting point.** AWS provides these (`ReadOnlyAccess`, `PowerUserAccess`, service-specific policies). Start here, tighten down.
- **Customer-managed policies for anything specific**, named clearly (`s3-read-checkout-bucket`, not `custom-policy-3`).
- **No inline policies except for narrow role-specific escape hatches**, and even then, comment why.

Machine identities:
- **IAM roles for services** — EC2 instance profiles, ECS task roles, EKS service accounts via IRSA, Lambda execution roles.
- **No long-lived keys in Secrets Manager** unless you're integrating with an external system that literally cannot federate. Even then, rotate them.

### 3. SCPs — the "nobody can do that" layer

Service Control Policies are AWS Organizations' preventive guardrail. They apply at the OU or account level and *deny* actions no matter what individual IAM policies say. If a user has `AdministratorAccess` in an account with an SCP that denies `s3:DeleteBucket`, they cannot delete buckets. Full stop.

**Where SCPs earn their keep:**
- Denying region access outside your operating regions (blast radius reduction)
- Denying deletion of security tooling (CloudTrail, GuardDuty, Config)
- Enforcing encryption-at-rest (deny creating unencrypted RDS/EBS/S3)
- Denying root user access outside break-glass procedures
- Denying instance types you don't want anyone using (accidentally launching a p5.48xlarge is a $200/hour mistake)

**Where SCPs bite:**
- SCPs *don't* apply to the management account. Never run workloads there.
- SCPs *don't* grant permissions — they only remove them. `*:*` in an SCP is still deny-only, it just doesn't deny anything.
- Debugging SCP denials from within an account is opaque. The API returns `AccessDenied` with no indication of *which* policy denied it. Enable CloudTrail; audit `AccessDenied` events with the SCP context.

A minimal but genuinely useful baseline SCP set:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["eu-west-2", "us-west-2", "ap-southeast-2"]
        },
        "ForAllValues:StringNotEquals": {
          "aws:PrincipalArn": ["arn:aws:iam::*:role/OrganizationAccountAccessRole"]
        }
      }
    },
    {
      "Sid": "DenySecurityToolingChanges",
      "Effect": "Deny",
      "Action": [
        "cloudtrail:StopLogging",
        "cloudtrail:DeleteTrail",
        "guardduty:DeleteDetector",
        "guardduty:DisassociateFromMasterAccount",
        "config:DeleteConfigurationRecorder",
        "config:StopConfigurationRecorder"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyRootUserActions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringLike": { "aws:PrincipalArn": "arn:aws:iam::*:root" }
      }
    }
  ]
}
```

Apply that to your top-level OU on day one. It's ~30 lines and eliminates entire classes of incidents.

### 4. Permission Boundaries — the "delegation cap"

Permission Boundaries are the least-understood control plane. They're a policy attached to an IAM role or user that *caps* the effective permissions of that entity. Even if the entity's identity policy says "you can do X," if the boundary doesn't allow X, X is denied.

**The one use case that matters:** delegated IAM administration. If you want developers to be able to create IAM roles for their own applications *without* being able to create a role that grants itself `AdministratorAccess`, you attach a permission boundary requirement to their role-creation permission. Any role they create must have your boundary attached; the boundary caps what those child roles can do.

Without permission boundaries, delegated IAM administration is unsafe. With them, it's routine.

```json
// Example: the boundary developers must attach to any role they create
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:*",
        "dynamodb:*",
        "sqs:*",
        "lambda:*",
        "logs:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Action": [
        "iam:*",
        "organizations:*",
        "kms:ScheduleKeyDeletion"
      ],
      "Resource": "*"
    }
  ]
}
```

And the policy that lets developers create roles *only if* they attach this boundary:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iam:CreateRole",
      "Resource": "arn:aws:iam::*:role/dev-*",
      "Condition": {
        "StringEquals": {
          "iam:PermissionsBoundary": "arn:aws:iam::123456789012:policy/DevPermissionBoundary"
        }
      }
    }
  ]
}
```

## The scaling growth path

You don't need all four control planes on day one. The maturity ladder:

| Team size | Config |
|---|---|
| **1-5 engineers, 1 account** | IAM users with MFA. Not ideal but livable. Rotate access keys quarterly. |
| **5-15 engineers, 1-3 accounts** | Identity Center + permission sets. Kill IAM users. This is the biggest single upgrade. |
| **15+ engineers, 3+ accounts** | Above + AWS Organizations + baseline SCPs (region lock, security tooling protection). |
| **Enterprise / regulated** | Above + permission boundaries for delegated admin + IAM Access Analyzer + ABAC via tags + quarterly access reviews. |

**The biggest mistake:** skipping straight to ABAC (attribute-based access control via tags) because it sounds elegant. ABAC is powerful but demands rigorous tagging discipline; if your org can't consistently tag resources, ABAC becomes worse than RBAC because it fails silently instead of visibly.

## What "least privilege" actually looks like in practice

The dictionary definition ("give each identity only the permissions they need") is unhelpful. The operational definition:

1. **Start-broad, tighten-narrow.** Grant `ReadOnlyAccess` broadly, then use IAM Access Analyzer's *last accessed* data to find services nobody actually uses. Remove those permissions after a quarter of confirmed non-use.
2. **Write policies as denials in critical paths.** "Anyone can do X *except* delete production databases outside a change window."
3. **Trust roles, not credentials.** If a script needs to run for 6 hours, give it a role it assumes for 6 hours — not an access key with `*:*`.
4. **Break-glass is documented, monitored, and rare.** One `EmergencyAccess` role. Its use fires an alert. Any use requires a post-hoc write-up.
5. **Access reviews are quarterly and painful.** If they're not painful, they're theatrical.

## Trade-offs to be honest about

| If you pick | You give up |
|---|---|
| **Identity Center** | Terraform automation for user/group provisioning is limited via the AWS provider (SCIM sync from your IdP is the sanctioned path). |
| **Restrictive SCPs** | Development friction. Every "why can't I do X" turns into a debug session against the SCP. Budget time for it. |
| **Permission Boundaries** | Complexity. Boundaries are three-way logic (identity policy AND resource policy AND boundary). Explaining them to a new hire takes an hour. |
| **ABAC** | Operational discipline. Tag your resources consistently and reliably, or don't do this. |

## Production-readiness checklist

Before declaring your IAM posture mature:

- [ ] Zero IAM users with console access exist (except break-glass)
- [ ] Zero long-lived access keys older than 90 days exist across the org
- [ ] Identity Center is the only path to human access
- [ ] Baseline SCPs applied at the top OU (region lock, security tooling, root user deny)
- [ ] All service credentials use IAM roles (EC2 instance profiles, ECS task roles, IRSA, Lambda execution roles)
- [ ] IAM Access Analyzer is enabled per account and its findings are reviewed monthly
- [ ] MFA enforced for all human identities via SCP or Identity Center policy
- [ ] Break-glass procedure documented, alerted on, and last exercised within 6 months
- [ ] Quarterly access review runs on a calendar (not "when we remember")

## Where to start if you're inheriting a mess

Order of operations:

1. **Enable AWS Organizations and Identity Center**, even if you only have one account. This is your foundation. (Half a day.)
2. **Federate identity from your IdP.** Kill IAM console users first, keep programmatic keys temporarily. (One day.)
3. **Apply baseline SCPs** — region lock, security tooling protection. (One day.)
4. **Audit IAM Access Analyzer findings.** Every `AccessDenied` in CloudTrail from a role tells you what over-permissioned access nobody's actually using. (Ongoing.)
5. **Add permission boundaries** when you're ready to delegate role creation to teams. (Not urgent until you feel the pain of centralized role provisioning.)
6. **ABAC** — only when tagging discipline is proven. (Optional; many orgs never need this.)

## Companion code

The IAM patterns above — Identity Center permission sets, baseline SCPs, permission boundary examples, and Terraform for the whole stack — live in [`onemoretechie/aws-infrastructure-as-code`](https://github.com/onemoretechie/aws-infrastructure-as-code) under `examples/iam-at-scale/`.

## Related reading

- [AWS IAM Identity Center — official docs](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [SCP best practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [Permission Boundaries deep dive](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)
- [Well-Architected Framework — Security pillar](/blog/well-architected-framework-walkthrough/) — where IAM sits in the wider review
- [Multi-Region Architecture](/blog/multi-region-failover/) — how identity federation interacts with cross-region failover
