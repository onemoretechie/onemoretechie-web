# onemoretechie-web

Source for **[onemoretechie.com](https://onemoretechie.com)** — an educator's blog covering AWS, DevOps, Cloud Architecture, Security, and Infrastructure as Code by a Principal Cloud Architect and DevSecOps leader.

Built with [Astro](https://astro.build/), deployed to [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).

## Stack

- **Framework:** Astro 5 (content collections, MDX, RSS, sitemap)
- **Fonts:** Outfit + JetBrains Mono (self-hosted via Astro's Google Fonts provider)
- **Design:** Dark-first with light mode toggle, cyan accent (`#22D3C8`), full CSS custom-properties token system
- **Hosting:** Cloudflare Workers Static Assets (build-on-push from this repo)

## Content model

Two collections defined in `src/content.config.ts`:

- **`topics/`** — one file per topic pillar. Adding a new pillar = drop a `.md` file + one line in `src/consts.ts` (`TOPIC_PILLARS`).
- **`blog/`** — tutorials and how-to posts. Front matter includes optional `youtube_url` and `github_repo` — these render as media cards on the post.

Five topic pillars locked (see `src/content/topics/`):

1. AWS — services, serverless, cost & FinOps
2. DevOps & CI/CD — pipelines, GitOps, observability, SRE
3. Cloud Architecture — multi-region, event-driven, well-architected
4. Security — IAM, zero-trust, compliance, threat modelling
5. IaC & Kubernetes — Terraform, Helm, K8s, Ansible

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
```

## Structure

```
src/
├── components/     BaseHead · Header · Footer · FormattedDate
├── content/
│   ├── topics/     5 pillar pages (.md)
│   └── blog/       tutorials (added via the content-pipeline workflow)
├── layouts/        page layouts
├── pages/
│   ├── index.astro          homepage (hero + topics grid + latest posts)
│   ├── topics/[...slug].astro   dynamic pillar routes
│   ├── blog/                blog index + post routes
│   └── about.astro
├── styles/global.css   design tokens + prose styles
├── consts.ts       site title, socials, pillar list, hero stats
└── content.config.ts   collection schemas
```

## License

MIT — see `LICENSE`.
