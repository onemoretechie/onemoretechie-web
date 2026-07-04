---
title: IaC & Kubernetes
description: Terraform, Helm, K8s patterns, Ansible — reproducible infrastructure at scale.
slug: iac-kubernetes
color: blue
icon: 📦
order: 5
github_repo: https://github.com/onemoretechie/aws-infrastructure-as-code
---

## What's covered under IaC & Kubernetes

The tooling and patterns that make infrastructure a version-controlled artefact instead of a screenshot in a Confluence page.

### Core areas

- **Terraform** — modules, workspaces, remote state, drift detection, at-scale patterns
- **Kubernetes** — production cluster setup, GitOps deployments, autoscaling, networking
- **Helm** — chart authoring, umbrella charts, chart testing
- **Ansible** — configuration management, playbook patterns, Molecule testing
- **Docker** — image hardening, multi-stage builds, minimal runtimes
- **Container orchestration** — ECS vs EKS vs Fargate — when each wins

### Companion repos

The `onemoretechie` GitHub account carries live example code for every pattern discussed here:
- [aws-infrastructure-as-code](https://github.com/onemoretechie/aws-infrastructure-as-code)
- [kubernetes-cookbook](https://github.com/onemoretechie/kubernetes-cookbook)
- [helm-charts-cookbook](https://github.com/onemoretechie/helm-charts-cookbook)
- [ansible-playbooks](https://github.com/onemoretechie/ansible-playbooks)
