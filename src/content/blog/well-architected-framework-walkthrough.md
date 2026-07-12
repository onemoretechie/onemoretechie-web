---
title: The AWS Well-Architected Framework — A Principal's Walkthrough
description: What a real Well-Architected Review feels like from the inside — where teams game the questions, which pillars actually surface risk, and how to run one that isn't theatre.
pubDate: 2026-07-05
topic: architecture
type: architecture-doc
tags: [well-architected, waf, architecture-review, six-pillars, aws-review]
draft: false
---

The AWS Well-Architected Framework (WAF) is one of those artefacts that everyone quotes and few teams actually use. AWS gives you six pillars, ~60 questions per lens, and a tool to score yourself. What you get out of it depends entirely on how honest the review is — and most reviews aren't.

This is the version that treats the WAF as a serious diagnostic tool: which pillars actually surface risk in a real production system, where teams (including mine) game the questions, and how to run a review that changes the roadmap instead of decorating a slide deck.

> **TL;DR.** The WAF's value isn't in the score — it's in the arguments the questions force you to have. Skip the tool if nobody at the table will disagree with the answers. The Reliability and Operational Excellence pillars catch the most real problems; Sustainability catches the fewest but signals maturity.

## The six pillars, in decreasing order of usefulness

The framework has six pillars. They are not equal. Ranked by how often they've surfaced real, actionable findings in reviews I've run:

| # | Pillar | What it actually catches |
|---|---|---|
| 1 | **Operational Excellence** | Missing runbooks, on-call gaps, deploy discipline, observability blind spots |
| 2 | **Reliability** | Untested failover, single-AZ dependencies, quota-limit surprises |
| 3 | **Security** | IAM sprawl, unencrypted resources, missing MFA on privileged access |
| 4 | **Cost Optimization** | Idle resources, oversized instances, absent tagging strategy |
| 5 | **Performance Efficiency** | Wrong compute family, absent caching layer, chatty API patterns |
| 6 | **Sustainability** | Rarely surfaces new findings, but validates cost-efficiency work retroactively |

The Well-Architected Tool doesn't rank pillars — every unchecked box counts the same. In practice, a High-Risk Issue (HRI) in Reliability warrants an urgent conversation; the same finding in Sustainability rarely does. Weight your remediation prioritisation accordingly.

## Where teams game the questions

Every pillar has questions where an honest answer requires admitting something inconvenient. The gaming patterns I see most often:

**"Do you use automation to test operational changes?"** — Teams check yes because they have some GitHub Actions pipeline, without asking whether that pipeline tests the *actual* change surface (Terraform plan diff, database migration, DNS cut) or only the application code.

**"Do you have a documented business continuity plan?"** — Teams check yes because there's a Confluence page. Nobody asks when it was last exercised.

**"Do you use IAM roles for cross-account access?"** — Teams check yes because *some* access is via roles. Nobody audits how many long-lived access keys are still active for what used to be temporary integrations.

**"Do you optimise for the least amount of resources?"** — Teams check yes because they downsized a couple of dev instances last quarter. Nobody looks at the m5.large fleet running at 8% utilisation.

The pattern is universal: the question is binary, the reality is a gradient, and the review captures neither. **The gaming isn't malicious — it's what happens when a reviewer answers on behalf of a team without evidence in front of them.**

## What a real review looks like

A Well-Architected Review that changes anything has three properties:

1. **Attended by people who disagree.** If only the platform team is in the room, only the platform team's blind spots are safe. Include product, security, and finance representatives — and let them argue.
2. **Backed by artifacts, not opinions.** For each "yes" answer, someone should be able to point at a runbook link, a deploy log, an IAM Access Analyzer report, a cost anomaly dashboard. If there's no artifact, the answer is "no with a plan."
3. **Time-boxed and repeated.** A one-time review is a snapshot. Re-run it every 6 months per major workload; drift is what actually catches you.

Anything less is documentation, not diagnostics.

## Pillar-by-pillar — the questions that actually surface risk

Rather than walk through all ~60 questions, here are the specific ones that most frequently trigger a "we should fix that" reaction in the room:

### Operational Excellence

- **OPS 4: How do you implement observability in your workload?** — Forces a real answer about tracing, not just "we have CloudWatch."
- **OPS 6: How do you mitigate deployment risks?** — Blue/green? Canary? Feature flags? Or just "hope"?
- **OPS 10: How do you manage workload and operations events?** — This is where the game-day question lives. When was the last one?

### Reliability

- **REL 2: How do you plan your network topology?** — Uncovers VPC/subnet decisions made three years ago that constrain everything since.
- **REL 6: How do you monitor workload resources?** — The follow-up: what triggers alarms wake someone up, and are those the right alarms?
- **REL 10: How do you use fault isolation to protect your workload?** — Multi-AZ, multi-region, or a single-zone deployment nobody wants to admit is single-zone.
- **REL 13: How do you plan for disaster recovery?** — The specific RTO/RPO question. Most teams have never quantified this precisely.

### Security

- **SEC 2: How do you manage identities for people and machines?** — Federated SSO or long-lived IAM users? Machine identities via roles or via access keys stored in Secrets Manager?
- **SEC 5: How do you protect your network resources?** — Security groups, NACLs, PrivateLink for third-party dependencies.
- **SEC 8: How do you protect your data at rest?** — Encryption by default, KMS key management, and *who* has decrypt permission.

### Cost Optimization

- **COST 5: How do you evaluate cost when you select services?** — Rarely done properly at the design stage. Teams reach for what they know.
- **COST 6: How do you meet cost targets when you select resource type, size and number?** — The Reserved Instances / Savings Plans / Spot mix.

### Performance Efficiency

- **PERF 2: How do you select and use compute resources?** — Graviton (ARM) vs x86 comes up here. Most teams haven't tested; the ~20% cost savings can be free money.
- **PERF 4: How do you configure your networking?** — Placement groups, enhanced networking, cross-AZ traffic.

### Sustainability

- **SUS 4: How do you take advantage of software patterns?** — Serverless-first, batch scheduling, right-sizing. The findings overlap almost entirely with Cost Optimization.

## The Well-Architected Tool workflow

Concrete steps to run a review that produces artifacts:

```bash
# 1. Define the workload in the WA Tool
aws wellarchitected create-workload \
  --workload-name "checkout-service" \
  --description "Payment checkout flow, multi-region" \
  --environment PRODUCTION \
  --lenses arn:aws:wellarchitected::aws:lens/wellarchitected \
  --review-owner "platform-team@example.com" \
  --industry-type Financials

# 2. Get the workload ID for subsequent commands
export WORKLOAD_ID=$(aws wellarchitected list-workloads \
  --workload-name-prefix checkout \
  --query 'WorkloadSummaries[0].WorkloadId' \
  --output text)

# 3. List the questions for the Reliability pillar
aws wellarchitected list-answers \
  --workload-id $WORKLOAD_ID \
  --lens-alias wellarchitected \
  --pillar-id reliability

# 4. Answer questions as you go (see docs for --answer JSON structure)
# 5. Generate a report
aws wellarchitected get-workload --workload-id $WORKLOAD_ID
```

For scale, the tool has a shared responsibility feature — you can share the workload with an AWS Solutions Architect for a formal review, or with other accounts in your organisation for a self-directed one.

## Translating findings into a roadmap

The Tool categorises unchecked items as HRI (High Risk), MRI (Medium Risk), or improvements. Naive teams treat the HRI list as the roadmap. That's wrong for two reasons:

1. **HRIs aren't all equally likely.** "You don't test failover annually" is an HRI. "Your primary region has never gone down" is a mitigating fact the tool doesn't know.
2. **Cost of remediation varies by 100×.** A missing runbook takes an afternoon. Multi-region active-active takes a quarter. Both might be HRIs.

A better rubric: **impact × likelihood ÷ cost-to-fix**. Findings with high impact, high likelihood, and low remediation cost get done next sprint. Findings with high impact but multi-quarter cost enter the roadmap as strategic initiatives. Findings with low likelihood get formally accepted as risk with a documented owner.

## Trade-offs to be honest about

| Pillar | Common tension |
|---|---|
| Reliability vs Cost Optimization | Multi-region active-active is 2× cost. The Cost pillar wants you to justify it. See the [Multi-Region Architecture playbook](/blog/multi-region-failover/) for how to frame that trade-off honestly. |
| Security vs Operational Excellence | Every additional guardrail (SCP, permission boundary, session policy) adds a hurdle developers route around. If your Security posture is high but Ops Excellence questions about "self-service" all say no, you have a friction problem. |
| Performance vs Sustainability | Over-provisioning to guarantee latency SLOs directly contradicts sustainability. Right-sizing gets you both, but only if you have the observability to prove headroom. |

## Production-readiness checklist for the review itself

Not the workload — the review process. Before running one:

- [ ] Product owner + platform lead + security lead + finance rep all in the room (or async but committed)
- [ ] Access to CloudTrail, Cost Explorer, IAM Access Analyzer, and the actual deploy pipelines
- [ ] Everyone agrees the answers will be logged as "no with a plan" if there's no artifact
- [ ] Time-boxed to 2 hours per pillar, spread across 2-3 sessions
- [ ] Follow-up meeting scheduled *before* the review, in 6 months, to re-run

## Where to start if you've never done one

Pick one workload — your most-critical or your most-neglected, either works — and run through the **Reliability pillar only**. Two hours. Answer honestly, note the gaps, produce a 3-item improvement list. If nothing on that list feels uncomfortable to admit, you weren't honest enough.

The value compounds: after two or three workload reviews, patterns emerge across your estate — always the same gaps in Ops Excellence, always the same untested runbooks. That pattern is the actual roadmap. The tool just surfaces it.

## Related reading

- [AWS Well-Architected Framework — official docs](https://aws.amazon.com/architecture/well-architected/)
- [AWS Well-Architected Tool](https://aws.amazon.com/well-architected-tool/) — the interactive companion
- [Multi-Region Architecture & Failover](/blog/multi-region-failover/) — deep-dive on the Reliability pillar's hardest question
