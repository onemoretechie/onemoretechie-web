---
title: AWS Multi-Region Architecture & Failover — A Principal's Playbook
description: When to run active-active vs pilot-light, which AWS services actually do the failover work, and the trade-offs no service page explains upfront.
pubDate: 2026-07-05
topic: architecture
type: architecture-doc
tags: [multi-region, failover, route53, aurora, disaster-recovery, well-architected, rto, rpo]
github_repo: https://github.com/onemoretechie/aws-infrastructure-as-code
draft: false
---

Multi-region is one of those topics where the AWS documentation tells you what the services *do* but not what the trade-offs feel like on a Tuesday at 3 AM. This post is the version I wish I'd had six years and several failovers ago — how to pick a failover model that matches your actual business, which services carry the real weight, and where each pattern will bite you.

> **TL;DR.** Pick a failover **model** first (single-region, pilot-light, warm standby, or active-active), not a service list. The model dictates your RTO/RPO ceiling, your monthly cost floor, and how much operational discipline your team needs. Get the model right and the service choices follow.

## Why multi-region at all?

Before touching Terraform, name the reason. There are only four honest ones:

1. **Regulatory** — data residency requirements force you into a specific region, and losing that region for a day means violating a contract.
2. **Latency** — end-users are geographically distributed and single-region latency (typically 100-300ms across continents) breaks the product.
3. **Business continuity** — a full regional outage would cost more per hour than the multi-region infrastructure costs per year.
4. **Political** — a VP demanded it after reading a Gartner report.

Reason 4 is the most common and the least defensible. Multi-region roughly **doubles** your infrastructure cost, adds a new class of failure modes (split-brain, replication lag, cross-region networking bills), and needs continuous validation to remain trustworthy. If you can't articulate a concrete answer beyond reason 4, the correct architecture is often **multi-AZ in one region** with excellent runbooks.

## The four failover models

| Model | RTO | RPO | Cost multiplier | When to pick |
|---|---|---|---|---|
| **Single-region, multi-AZ** | 0 (no failover) | 0 | 1× | Vast majority of workloads. AZ failures are more common than region failures. |
| **Pilot-light** | Hours | Minutes | 1.05–1.2× | Compliance-driven DR where minutes of data loss are acceptable and hours of downtime are recoverable. |
| **Warm standby** | 5–15 min | Seconds | 1.4–1.7× | Business-critical systems where a manual runbook is acceptable but hours are not. |
| **Active-active** | ~0 | ~0 (with global data services) | 2×+ | Real user-facing latency requirements or hard uptime SLAs. Also: teams with the operational maturity to run two production systems continuously. |

**The single biggest mistake** I see: teams pick active-active because it sounds correct, then discover their team can't reliably deploy to two regions on the same day. A month later the standby region drifts. Six months later nobody trusts the failover. The system is now worse than a single-region deployment because it looks like DR without being DR.

**Pilot-light is under-appreciated.** For a lot of internal enterprise systems, the honest failover appetite is *"we can be down for four hours if it saves us $200k/year"* — which is exactly what pilot-light gives you.

## The services that actually do failover work

Multi-region isn't a single AWS service. It's an interaction between six-ish services, each doing one specific thing:

### Route 53 — the front door

Route 53 is where failover *actually* happens for most workloads. Two patterns matter:

- **Health-check based failover records** — Route 53 monitors your primary endpoint. When it fails health checks, DNS starts returning the secondary. TTL of 60s means clients transition within ~2 minutes. Below 60s, intermediate resolvers clamp anyway. Set your TTL to 60.
- **Latency-based routing** — for active-active, Route 53 sends each client to their closest region. When a region goes dark and fails health checks, its records drop from the pool.

The gotcha: **health checks are per-endpoint, not per-region**. A single unhealthy endpoint doesn't mean the region is unhealthy. Design your health check to test the actual user path (usually a lightweight `/health` endpoint that touches the database), not just `TCP:443`.

### Aurora Global Database — the data plane

Aurora Global Database replicates a writer cluster in Region A to reader clusters in up to 5 other regions with typical replication lag under 1 second. During a regional outage:

- Promote a secondary region to primary via the `failover_global_cluster` API. Promotion takes ~60 seconds.
- Applications reconnect via the *new* writer endpoint. This means your application needs to be able to switch endpoints — hardcoded connection strings force a code deploy during an outage, which is exactly when you don't want to deploy.

The gotcha: **cross-region data loss during unplanned failover** is up to the replication lag at the moment of failure — typically <1s but can spike during heavy write bursts. If your compliance stance is "zero data loss ever," you need synchronous replication, which AWS doesn't offer across regions at any acceptable latency.

### S3 Cross-Region Replication (CRR)

For object storage. Set it up per-bucket with a replication rule; new objects replicate within 15 minutes (or use S3 Replication Time Control for a 15-minute SLA). Existing objects don't replicate automatically — you need an S3 Batch Replication job for the backfill.

The gotcha: **deletes don't replicate by default** — that's often a *feature* (protects against accidental deletion) but occasionally a surprise.

### DynamoDB Global Tables

If you're already on DynamoDB, Global Tables give you multi-region multi-writer replication. Every region can accept writes; conflicts resolve last-writer-wins. For active-active DynamoDB workloads this is close to magic; for anything requiring strong consistency across regions, it's a footgun.

### CloudFront + Origin Failover

Sits in front of everything else. Configure a primary origin (Region A ALB) and a secondary origin (Region B ALB). CloudFront failover triggers on 5xx errors from primary. This gives you a *very* fast failover for read-heavy traffic — sub-30-seconds — because the CDN edge decides, not DNS.

### AWS Backup + AWS Application Recovery Controller

**Backup**: for pilot-light, replicate EBS snapshots + RDS snapshots to the DR region on a schedule. Cheaper than running warm resources.

**Application Recovery Controller** (ARC): the newer service for orchestrating regional failovers with routing controls and readiness checks. Worth knowing about; overkill for most single-team deployments.

## A concrete pattern: warm standby with Aurora Global

Here's what a warm-standby architecture looks like in practice — most enterprises' sweet spot. Region A (`eu-west-2`) is the active production region; Region B (`us-west-2`) is a warm secondary running scaled-down capacity.

```hcl
# terraform/multi-region-failover/main.tf

# --- Primary region (eu-west-2) ---
resource "aws_rds_global_cluster" "app" {
  global_cluster_identifier = "app-global"
  engine                    = "aurora-mysql"
  engine_version            = "8.0.mysql_aurora.3.05.2"
  database_name             = "app"
}

resource "aws_rds_cluster" "primary" {
  provider                    = aws.primary
  cluster_identifier          = "app-primary"
  global_cluster_identifier   = aws_rds_global_cluster.app.id
  engine                      = aws_rds_global_cluster.app.engine
  engine_version              = aws_rds_global_cluster.app.engine_version
  # ... two writer instances, m6g.large
}

# --- Secondary region (us-west-2) ---
resource "aws_rds_cluster" "secondary" {
  provider                  = aws.secondary
  cluster_identifier        = "app-secondary"
  global_cluster_identifier = aws_rds_global_cluster.app.id
  engine                    = aws_rds_global_cluster.app.engine
  engine_version            = aws_rds_global_cluster.app.engine_version
  # Scaled down — one reader instance, m6g.large
}

# --- Route 53 failover ---
resource "aws_route53_health_check" "primary" {
  fqdn              = "api-primary.example.com"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
}

resource "aws_route53_record" "api_primary" {
  zone_id = var.zone_id
  name    = "api.example.com"
  type    = "A"
  set_identifier = "primary"
  failover_routing_policy { type = "PRIMARY" }
  health_check_id = aws_route53_health_check.primary.id
  ttl     = 60
  records = [aws_lb.primary.dns_name]
}

resource "aws_route53_record" "api_secondary" {
  zone_id = var.zone_id
  name    = "api.example.com"
  type    = "A"
  set_identifier = "secondary"
  failover_routing_policy { type = "SECONDARY" }
  ttl     = 60
  records = [aws_lb.secondary.dns_name]
}
```

That's ~60 lines of Terraform for the DR foundation. The rest is application-layer: ECS/EKS services running in both regions, with the secondary's autoscaling group at min=1 and the primary at min=3. Failover means bumping the secondary's min to production capacity — a single command.

## Trade-offs to be honest about

| If you pick | You give up |
|---|---|
| **Pilot-light** | RTO of hours, not minutes. If revenue impact is >$50k/hr, this is the wrong choice. |
| **Warm standby** | ~1.5× cost, plus continuous validation discipline. If nobody tests the failover quarterly, you don't have DR — you have a Terraform file. |
| **Active-active** | 2× cost, dual-region deploy discipline, cross-region data-consistency gymnastics. If your ORM assumes single writer, you're rewriting queries. |
| **Aurora Global** | 60-second failover minimum. If your SLA needs <30s, look at DynamoDB Global Tables instead — different consistency trade-offs. |
| **Route 53 DNS failover** | Client caching. Legacy JVMs cache DNS for the process lifetime unless configured otherwise. Test with your actual stack. |

## Production readiness checklist

Before declaring the DR system trustworthy, all of these should be true:

- [ ] **A game-day was run in the last 90 days.** Actual failover, not a tabletop exercise. Actual measured RTO and RPO.
- [ ] **The runbook is one page.** Executable in a crisis. If it references three Confluence pages, it's not a runbook.
- [ ] **The application handles endpoint switching.** No hardcoded database connection strings, no assumptions about primary region.
- [ ] **CI/CD deploys to both regions in the same pipeline run.** Region drift is the #1 killer of active-passive setups.
- [ ] **Cross-region networking cost is monitored.** Aurora Global replication egress + S3 CRR + inter-region VPC peering add up faster than most teams expect.
- [ ] **Health check tests the actual user path.** Not just port 443. Include a database ping, cache warm, and a canary read.
- [ ] **DNS TTL is 60s.** Confirmed via `dig`, not what the AWS console claims.
- [ ] **Secrets are replicated to both regions.** AWS Secrets Manager cross-region replication (2023 feature) — turn it on.

## Where I'd start if you're new to this

**Don't build for active-active on day one.** Start with pilot-light: replicated snapshots + Terraform for the secondary region + a documented restore runbook. Cost is minimal, and you learn the actual failure modes without production risk.

Once pilot-light works and someone has actually restored from it, upgrade to warm standby by keeping a scaled-down secondary running. Once warm standby has survived a game-day, evaluate whether the extra cost of active-active is justified — usually it isn't, until you have specific latency evidence.

Multi-region is a maturity ladder, not a checkbox.

## Companion code

The Terraform modules in [`onemoretechie/aws-infrastructure-as-code`](https://github.com/onemoretechie/aws-infrastructure-as-code) include working examples of each pattern — pilot-light, warm standby, and a minimal active-active scaffold. The `examples/multi-region-failover/` directory has the exact configuration referenced above, with variables for region pair, instance sizing, and health-check paths.

## Related reading

- [AWS Well-Architected Framework — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) — the canonical reference on RTO/RPO framing
- [Aurora Global Database best practices](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)
- [Route 53 health-check based failover](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html)
