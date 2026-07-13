---
title: EKS Production Setup from Scratch
description: The seven decisions that make an EKS cluster survive its first year — node management, IAM, add-ons, upgrades. Karpenter over Cluster Autoscaler, Pod Identity over IRSA, and where teams still get it wrong.
pubDate: 2026-07-05
topic: iac-kubernetes
type: architecture-doc
tags: [eks, kubernetes, karpenter, irsa, pod-identity, cluster-upgrade, aws-loadbalancer-controller, eks-addons]
github_repo: https://github.com/onemoretechie/kubernetes-cookbook
draft: false
---

An EKS cluster running the AWS defaults is a demo. A production EKS cluster is a set of deliberate architectural decisions layered on top of it — most of which the AWS console won't ask you to make and which will hurt six months later if you skipped them.

This post is the seven decisions that separate an EKS setup that survives its first year from one that becomes an incident magnet. It assumes you know Kubernetes well enough to run a cluster; it focuses on the specifically-EKS choices — node management, IAM patterns, add-ons, upgrades, and the guardrails you wire in before the first team deploys anything real.

> **TL;DR.** In 2026, the modern defaults are: **Karpenter for node management** (not Cluster Autoscaler), **Pod Identity for pod IAM** (not IRSA, though IRSA still works), **AWS-managed EKS add-ons** for the core plugins, and **explicit control-plane logging on**. Skip these and you'll rebuild the setup in a year anyway.

## Before EKS — do you actually need Kubernetes?

The most honest question. Kubernetes has a real operational cost, and EKS as a service still leaves you owning the node layer, upgrades, add-on lifecycle, and RBAC hygiene. Two questions decide it:

1. **Do you have >3 services with different scaling profiles that need to share compute efficiently?** If no, ECS Fargate is dramatically simpler.
2. **Do you have engineers who will own the platform in the medium term?** If no, App Runner or Lambda + Fargate covers 80% of use cases without a control plane.

**The order-of-magnitude cost comparison** (rough numbers, small workload):

| Platform | Ops overhead | Monthly floor cost |
|---|---|---|
| Lambda + API Gateway | Minimal | ~$0-50 (pure usage) |
| ECS Fargate | Low | ~$50-150 (task hours) |
| App Runner | Low | ~$50-200 |
| **EKS + managed node groups** | **Medium-high** | **~$73 control plane + $200+ nodes** |
| Self-managed K8s on EC2 | High | Nodes only, but full ops burden |

If EKS still wins — usually because you need custom controllers, StatefulSets, or complex networking — proceed. Just be aware you're picking a platform that requires ongoing attention, not a service.

## Decision 1 — Cluster topology

The big three choices for the cluster itself:

**How many clusters?** Modern guidance: **one production cluster per environment per region, with namespace-per-tenant isolation.** Multi-cluster-per-team was the fashion in 2020; it costs ~$73/month per cluster in control plane fees before you add any nodes, plus multiplies every operational task. Only split clusters when the isolation is a hard requirement (regulated data, network-plane separation).

**Fargate or managed node groups?** Both, for different workloads:
- **Fargate** for tenant-isolated workloads, one-off jobs, or predictable-baseline services where you want zero node ops.
- **Managed node groups (via Karpenter)** for the bulk of production traffic where Fargate's cold-start latency and cost floor are limiting.

Don't try to run everything on Fargate. It costs about 20% more per vCPU-hour and has a 30-second cold-start hit that kills request latency for burst traffic.

**Private or public control plane endpoint?** **Private, always, for production.** Public endpoints expose the K8s API to the internet; even with strong RBAC that's a bad default. Configure:

```hcl
resource "aws_eks_cluster" "prod" {
  name = "prod-eu-west-2"
  version = "1.30"
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = false
    security_group_ids      = [aws_security_group.cluster.id]
  }

  # Log everything — costs a few dollars, saves hours during incidents
  enabled_cluster_log_types = [
    "api", "audit", "authenticator", "controllerManager", "scheduler"
  ]
}
```

Enabling all five control-plane log types costs a few dollars a month per cluster and gives you the audit trail you'll want the first time someone deletes a namespace they shouldn't have.

## Decision 2 — Node management: Karpenter over Cluster Autoscaler

In 2026, **Karpenter is the default choice for EKS node autoscaling.** The Cluster Autoscaler (CA) was the standard for years; Karpenter now outperforms it on every dimension that matters:

| | Cluster Autoscaler | Karpenter |
|---|---|---|
| Provisioning speed | ~2-3 min | ~30 sec |
| Instance-type selection | Pre-defined ASGs | Just-in-time, matches pod requirements |
| Consolidation (removing unused nodes) | Slow, safe | Aggressive, safe |
| Spot instance support | Manual per-ASG | Native, mixed with on-demand |
| Multi-arch (arm64/x86) | Separate ASGs | One `NodePool` with fallback |
| Complexity | Higher (ASGs to manage) | Lower (declarative NodePool CRDs) |

Karpenter's `NodePool` CRD lets you declare intent instead of managing ASGs:

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  template:
    spec:
      requirements:
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["m6g", "m6i", "c6g", "c6i"]
        - key: karpenter.k8s.aws/instance-size
          operator: In
          values: ["large", "xlarge", "2xlarge"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: kubernetes.io/arch
          operator: In
          values: ["arm64", "amd64"]
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
  limits:
    cpu: 1000
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 30s
```

That single NodePool provisions the cheapest EC2 instance that fits pending pods, prefers Spot, falls back to on-demand, mixes arm64 and x86 based on image support, and consolidates aggressively. In previous years that was multiple ASGs, a spot-termination handler, and a monitoring dashboard. Now it's ~30 lines of YAML.

**One gotcha:** Karpenter's consolidation will move your pods around more than you're used to. Set `PodDisruptionBudget`s for every deployment that shouldn't handle a restart, and use `karpenter.sh/do-not-disrupt: "true"` annotations for pods that genuinely can't be moved (long-running jobs, StatefulSet primaries mid-election).

## Decision 3 — IAM for pods: Pod Identity over IRSA

For years, **IRSA (IAM Roles for Service Accounts)** was the way to give pods AWS permissions. In late 2023 AWS launched **EKS Pod Identity**, which is now the recommended approach:

| | IRSA | EKS Pod Identity |
|---|---|---|
| Setup | Per-cluster OIDC provider registration | Cluster add-on, done once |
| Association | Annotation on ServiceAccount → role ARN | ServiceAccount + Pod Identity Association |
| Cross-account role assumption | Complex, requires trust policy edits | Native |
| Credential rotation | Every 12 hours (STS token) | Every 12 hours, simpler token exchange |
| Debuggability | Mysterious `AccessDenied` when misconfigured | Better error messages |

**Both still work.** If you have IRSA today, don't rush to migrate. New clusters should default to Pod Identity.

Enable Pod Identity as an EKS managed add-on:

```bash
aws eks create-addon \
  --cluster-name prod-eu-west-2 \
  --addon-name eks-pod-identity-agent
```

Then associate a role to a ServiceAccount:

```bash
aws eks create-pod-identity-association \
  --cluster-name prod-eu-west-2 \
  --namespace checkout \
  --service-account checkout-sa \
  --role-arn arn:aws:iam::123456789012:role/checkout-pod-role
```

Any pod using the `checkout-sa` ServiceAccount in the `checkout` namespace now gets STS credentials for `checkout-pod-role`. No annotations, no OIDC hoops.

## Decision 4 — EKS-managed add-ons over self-installed

Every EKS cluster needs a set of plugins — CNI, kube-proxy, CoreDNS, EBS CSI driver, and increasingly Pod Identity Agent. These can be installed as Helm charts or as **EKS-managed add-ons**. Choose managed add-ons.

**Why:**
- Automatic version compatibility with the control plane (AWS tests each combo)
- One-command upgrades
- Rollback via API
- No Helm chart version drift across clusters

```hcl
resource "aws_eks_addon" "vpc_cni" {
  cluster_name  = aws_eks_cluster.prod.name
  addon_name    = "vpc-cni"
  addon_version = "v1.19.0-eksbuild.1"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"
}

resource "aws_eks_addon" "coredns" {
  cluster_name  = aws_eks_cluster.prod.name
  addon_name    = "coredns"
  addon_version = "v1.11.4-eksbuild.2"
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name  = aws_eks_cluster.prod.name
  addon_name    = "kube-proxy"
  addon_version = "v1.30.5-eksbuild.3"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name  = aws_eks_cluster.prod.name
  addon_name    = "aws-ebs-csi-driver"
  addon_version = "v1.36.0-eksbuild.1"
  service_account_role_arn = aws_iam_role.ebs_csi.arn
}

resource "aws_eks_addon" "pod_identity" {
  cluster_name  = aws_eks_cluster.prod.name
  addon_name    = "eks-pod-identity-agent"
  addon_version = "v1.3.4-eksbuild.1"
}
```

The four things you'll still install via Helm (no managed add-on yet, or you want more customisation):

- **Karpenter** — via Helm
- **AWS Load Balancer Controller** — ingress → ALB/NLB
- **External DNS** — auto-manage Route 53 records
- **Cert-manager** — TLS cert automation

## Decision 5 — Observability

Kubernetes generates enormous volumes of logs and metrics. The default CloudWatch integration is expensive and low-signal. The pattern that works:

**Metrics:**
- **Prometheus** running in-cluster (either via `kube-prometheus-stack` Helm chart or Amazon Managed Service for Prometheus)
- **Grafana** either in-cluster or as Amazon Managed Grafana
- Scrape kube-state-metrics, node-exporter, and workload metrics via ServiceMonitors

**Logs:**
- **Fluent Bit** DaemonSet shipping to CloudWatch, or better, to Amazon OpenSearch or a dedicated log store
- Set log retention to 30 days by default; anything longer needs a business reason
- Don't ship debug logs — they're 80% of volume and 5% of value

**Traces:**
- OpenTelemetry Collector as a DaemonSet
- AWS X-Ray or a third-party (Honeycomb, Datadog, Grafana Tempo)

**The single highest-value dashboard** for an EKS cluster shows: pod restart rate, node CPU/memory utilisation, unschedulable pods, and API server latency. If those four are green, everything else is probably fine.

## Decision 6 — Upgrade strategy

EKS versions have a **14-month support window**. You will upgrade approximately every 12 months, and unlike most software, you cannot skip minor versions — control plane upgrades are one-minor-at-a-time.

The upgrade sequence:

1. **Read the AWS EKS version upgrade docs** for the target version. Note breaking changes, deprecated APIs, and add-on version requirements.
2. **Audit deprecated APIs** in your cluster: `kubectl api-versions` + `pluto detect-all-in-cluster` to find deprecated resources.
3. **Test in staging first.** Actual test, not a synthetic one — deploy real workloads and watch for a week.
4. **Upgrade control plane.** ~30 minutes, no workload impact if API deprecations are handled.
5. **Upgrade add-ons** to versions compatible with the new control plane.
6. **Upgrade node groups** — this is where workload disruption happens. Karpenter handles this smoothly via node consolidation; managed node groups do rolling updates.
7. **Verify.** Recreate a pod, run smoke tests, watch metrics for 24 hours.

**The single most common failure mode:** teams skip step 2 (deprecated API audit) and their operators/controllers break because the API version they used is gone. `pluto` is a 5-minute install that prevents this.

## Decision 7 — Cost management

EKS costs come from four places: control plane ($73/month/cluster), nodes (dominant), data transfer (surprisingly high), and observability (surprisingly high).

**Node cost reduction, in order of return:**
1. **Karpenter with Spot mix.** 50-70% node cost reduction typically. Non-negotiable for stateless workloads.
2. **Graviton (arm64) instances.** ~20% cost reduction per vCPU. Almost every mainstream image is now multi-arch; test yours.
3. **Right-sized requests.** VPA (Vertical Pod Autoscaler) in recommendation mode surfaces oversized requests. Adjust manually — auto-VPA in production is still risky.
4. **Consolidation.** Karpenter does this by default; verify `consolidateAfter` is short (30s-2m).

**Data transfer reduction:**
- Cross-AZ traffic is $0.01/GB in each direction. On chatty microservices this adds up faster than you'd think. Use `topology.kubernetes.io/zone` affinity to keep pod-to-pod traffic in-AZ where possible.
- NAT Gateway costs. Consider VPC Endpoints for S3, ECR, and other frequently-accessed AWS APIs to route around NAT.

**Observability cost:**
- CloudWatch Logs ingestion is $0.50/GB. A chatty cluster can generate 100GB/day. Drop debug logs at the Fluent Bit filter stage, don't at the log group level.
- Managed Prometheus scales cost with metric cardinality — audit high-cardinality labels regularly.

## Trade-offs to be honest about

| If you pick | You give up |
|---|---|
| **Single cluster with namespaces** | Blast-radius isolation. Node compromise potentially affects all tenants. Balance with strong RBAC + network policies. |
| **Karpenter** | Predictability of pre-provisioned capacity. Karpenter may take 30s to provision a node in a traffic spike — pre-warm with headroom pods if p99 latency is critical. |
| **Spot instances** | Interruption tolerance. Applications need to handle 2-minute termination warnings. Not for StatefulSet primaries. |
| **Pod Identity over IRSA** | Cross-cluster consistency if your other clusters are still on IRSA. Migrate incrementally, don't split-brain. |
| **Managed add-ons over Helm** | Fine-grained control over some Helm values. Managed add-ons expose fewer knobs; some organisations need those knobs. |
| **Private control plane endpoint** | Convenience of local `kubectl`. You'll need a bastion, VPN, or Session Manager tunnel — worth it. |

## Production-readiness checklist

Before declaring an EKS cluster production-ready:

- [ ] Private control plane endpoint, public access disabled
- [ ] All 5 control plane log types enabled + shipped to CloudWatch
- [ ] Nodes in private subnets, no public IPs
- [ ] Karpenter installed and NodePool defined with Spot + on-demand mix
- [ ] Pod Identity Agent (or IRSA) configured; no long-lived AWS keys mounted as secrets
- [ ] EKS-managed add-ons for vpc-cni, kube-proxy, coredns, ebs-csi, pod-identity-agent
- [ ] AWS Load Balancer Controller installed for Ingress
- [ ] Network policies enabled (Calico or Cilium) and default-deny in shared namespaces
- [ ] `PodDisruptionBudget` for every Deployment with replicas > 1
- [ ] Prometheus + Grafana (managed or self-hosted) with the four-metric baseline dashboard
- [ ] Fluent Bit shipping logs, retention configured
- [ ] `pluto` runs in CI against manifests to catch deprecated APIs
- [ ] Cluster upgrade runbook exists and last-tested in staging within 6 months
- [ ] Cost tags applied (`environment`, `team`, `service`) and reflected in Cost Explorer

## Where to start if you're building from scratch

Order of operations that avoids painful rework:

1. **VPC + private subnets first.** EKS assumes existing VPC structure. Get the networking right before the cluster.
2. **Cluster with private endpoint + control plane logging.** Empty cluster, no workloads.
3. **Core managed add-ons** (vpc-cni, kube-proxy, coredns, pod-identity-agent).
4. **Karpenter install + first NodePool.** Verify nodes provision on a test pod.
5. **AWS Load Balancer Controller.** Verify Ingress → ALB works.
6. **Observability baseline** — Prometheus, Grafana, basic dashboard.
7. **First real workload** — a simple stateless service with Ingress, PDB, resource requests, ServiceAccount + Pod Identity.
8. **Network policies** — start with default-allow, move to default-deny once workloads are labelled.
9. **Upgrade rehearsal** — do a minor upgrade on the staging cluster before the first prod workload lands.

Each step is a day or two. The full setup is 2-3 weeks of platform work before the first application deploys — this is the honest baseline.

## Companion code

The full Terraform + Helm setup — VPC, cluster, Karpenter NodePools, Pod Identity, add-ons, and the AWS Load Balancer Controller — lives in [`onemoretechie/kubernetes-cookbook`](https://github.com/onemoretechie/kubernetes-cookbook) under `recipes/eks-production/`.

## Related reading

- [EKS best practices guide](https://aws.github.io/aws-eks-best-practices/) — AWS's own, dense but worth reading
- [Karpenter documentation](https://karpenter.sh/)
- [EKS Pod Identity docs](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
- [Terraform at Scale](/blog/terraform-at-scale/) — how to structure the state file for cluster infrastructure
- [IAM at Scale](/blog/iam-at-scale/) — Pod Identity ties into the broader IAM story
- [Multi-Region Architecture](/blog/multi-region-failover/) — cross-region EKS considerations
