# How to add a new page to onemoretechie.com

A one-page reference for adding content to the OneMoreTechie site. Content is authored in **markdown / MDX** and organized into Astro content collections. This guide covers the workflow for both blog posts and topic pillar pages.

> Screenshots referenced as `<!-- screenshot: ... -->` can be added later by dragging an image onto each placeholder line inside the GitHub editor. The text instructions work without them.

---

## TL;DR — the 60-second workflow

1. Open **[github.com/onemoretechie/onemoretechie-web](https://github.com/onemoretechie/onemoretechie-web)**
2. Navigate to `src/content/blog/`
3. Click **Add file → Create new file**
4. Name it `your-post-slug.md` (lowercase, hyphens, no spaces)
5. Type the frontmatter block + your content (see template below)
6. Scroll down, click **Commit changes**
7. Cloudflare rebuilds in ~60 seconds → post live at `onemoretechie.com/blog/your-post-slug/`

**Nothing to install. No git command line. No `npm run build`.** Astro rebuilds on push automatically.

---

## Content structure

```
onemoretechie-web/
├── src/
│   ├── content/
│   │   ├── blog/                    ← tutorials + how-to posts (.md / .mdx)
│   │   │   ├── eks-production-setup.md
│   │   │   ├── iam-at-scale.md
│   │   │   ├── multi-region-failover.md
│   │   │   ├── terraform-at-scale.md
│   │   │   └── well-architected-framework-walkthrough.md
│   │   │
│   │   └── topics/                  ← 5 pillar pages (.md / .mdx)
│   │       ├── aws.md
│   │       ├── devops.md
│   │       ├── architecture.md
│   │       ├── security.md
│   │       └── iac-kubernetes.md
│   │
│   ├── content.config.ts            ← collection schemas (zod-validated)
│   ├── consts.ts                    ← site constants + TOPIC_PILLARS
│   ├── pages/                       ← Astro routes (.astro files)
│   ├── layouts/                     ← page shells
│   ├── components/                  ← reusable UI components
│   └── styles/                      ← global CSS + tokens
│
├── public/                          ← static assets served as-is
├── astro.config.mjs                 ← Astro config
├── package.json
├── AGENTS.md                        ← guide for agent-based edits
├── README.md
└── CLAUDE.md                        ← Claude Code repo instructions
```

## Blog post — the required frontmatter

Every blog post is a `.md` or `.mdx` file under `src/content/blog/` starting with a frontmatter block. The schema is zod-enforced in `src/content.config.ts`.

**Required fields:**

```markdown
---
title: "Your post title"
description: "One-sentence summary — appears in social cards + list previews."
pubDate: 2026-07-24
topic: aws                # one of: aws, devops, architecture, security, iac-kubernetes
type: tutorial            # one of: tutorial, runbook, architecture-doc, cheat-sheet, interview-qa, study-notes
tags: [ec2, autoscaling]  # free-form array
---

Your post content starts here.
```

**Optional fields:**

```markdown
updatedDate: 2026-08-01
heroImage: ../../assets/hero-images/your-post-hero.png
heroImageAlt: "Description of the hero image for accessibility"
youtube_url: https://youtube.com/watch?v=XXXXX
github_repo: https://github.com/onemoretechie/example-repo
github_path: infra/eks
draft: true               # draft: true hides from production build
```

**Frontmatter tips:**

- `pubDate` uses `YYYY-MM-DD` format
- `topic` is strict — must match one of the 5 pillars exactly (see `TOPIC_PILLARS` in `src/consts.ts`)
- `type` filters the content on listing pages (e.g., "show me all runbooks")
- `youtube_url` renders a YouTube card at the top + bottom of the post
- `github_repo` (+ optional `github_path`) renders a GitHub source card
- `draft: true` — post is hidden from production; useful during authoring

## Markdown syntax (95% of what you'll write)

### Headings

```markdown
# Never used in blog posts — title comes from frontmatter

## Main section heading

### Subsection heading

#### Deep subsection (rarely needed)
```

### Bold + italic

```markdown
This has **bold** and *italic* words.
```

### Lists

```markdown
Bullets:
- First item
- Second item

Numbered:
1. First step
2. Second step
```

### Links

```markdown
[External site](https://aws.amazon.com/eks/)
[Another post](/blog/iam-at-scale/)
```

### Code blocks

Inline: `` `single backticks` ``.

Fenced blocks with syntax highlighting:

````markdown
```bash
kubectl get pods -n kube-system
```

```yaml
apiVersion: apps/v1
kind: Deployment
```

```hcl
resource "aws_iam_role" "example" {
  name = "example-role"
}
```
````

**Supported languages**: `bash`, `sh`, `yaml`, `hcl` (Terraform), `json`, `python`, `javascript`, `typescript`, `sql`, `dockerfile`, `text`, and many more.

### Images

Save your image to `src/assets/` and reference:

```markdown
![Alt text describing the image](../../assets/your-image.png)
```

For hero images (top of post), set `heroImage` in the frontmatter instead of inline markdown.

### Admonitions (via MDX only)

If you use `.mdx` extension (not `.md`), you get JSX in your content:

```mdx
import Callout from '../../components/Callout.astro';

<Callout type="warning">
Never commit AWS credentials to Git — use IAM Roles or OIDC federation instead.
</Callout>
```

For plain `.md`, use blockquote callouts:

```markdown
> **Warning**: Never commit AWS credentials to Git.
```

### Tables

```markdown
| Service | Purpose |
|---|---|
| EKS | Managed Kubernetes |
| ECS | Managed containers |
```

## Adding a new topic pillar

The 5 pillars are locked (aws, devops, architecture, security, iac-kubernetes). Adding a 6th requires:

1. Add the new slug to the enum in `src/content.config.ts` (both `blog.topic` and `topics.slug`)
2. Add an entry to `TOPIC_PILLARS` in `src/consts.ts` (name, color, description)
3. Create `src/content/topics/<new-slug>.md` with the topic pillar frontmatter
4. Verify locally with `astro dev`

Discuss before adding new pillars — pillar count affects homepage grid layout.

## Local development (optional but recommended for long posts)

Install once:

```bash
git clone git@github.com:onemoretechie/onemoretechie-web.git
cd onemoretechie-web
npm install
```

Then per session:

```bash
astro dev --background
```

Preview at `http://localhost:4321`. Manage the background server:

```bash
astro dev status
astro dev logs
astro dev stop
```

Full documentation: [Astro docs — routing](https://docs.astro.build/en/guides/routing/), [Astro docs — content collections](https://docs.astro.build/en/guides/content-collections/).

## Not a markdown person? Author in Word instead

The site only builds `.md` / `.mdx` files — but you can author in Word / Google Docs and convert. See the [ORATechno CONTRIBUTING.md conversion section](https://github.com/chandramanit/oratechno/blob/main/CONTRIBUTING.md) for the full layman guide (paths: Pandoc, Google Docs, AI conversion).

**Pandoc (recommended)** — one command:

```bash
pandoc your-file.docx -o your-post.md --extract-media=./images
```

Then:

1. Move `your-post.md` to `src/content/blog/`
2. **Add the OMT frontmatter block at the top** (Pandoc doesn't know OMT's schema)
3. Move images from `./images/` to `src/assets/` and update paths
4. Commit + push

## Draft workflow

To publish gradually:

1. Create your post with `draft: true` in frontmatter
2. Commit — it's on GitHub but hidden from the live site
3. Iterate over days/weeks
4. When ready, remove `draft: true` (or set to `false`) + commit
5. Post goes live on next Cloudflare rebuild

## Testing before commit

**Locally:**

```bash
astro dev
```

Preview at `http://localhost:4321/blog/your-post-slug/`.

**Type check:**

```bash
npx astro check
```

Verifies frontmatter matches the zod schema. If any required field is missing or a wrong enum value is used, this errors before build.

**Build test:**

```bash
npm run build
```

Runs the full production build. Same behavior as Cloudflare will run post-push.

## What NOT to do

- **Don't skip frontmatter validation** — `astro check` will catch invalid frontmatter, but so will Cloudflare Workers Build (with less-helpful errors). Better to catch locally.
- **Don't add topics outside the 5 pillars** without discussion + schema update
- **Don't upload `.docx` files** — the site serves rendered HTML from markdown
- **Don't inline massive images** — put them in `src/assets/`; Astro handles optimization
- **Don't hardcode Cloudflare URLs** — use relative paths (`/blog/...`) not absolute

## How to undo a mistake

Every commit is revertable in 2 clicks:

1. GitHub → **Commits** tab
2. Find the commit → **...** menu → **Revert**

Cloudflare rebuilds in ~60 seconds, back to the previous state.

## For deeper reference

- **[MAINTAINER_GUIDE.md](MAINTAINER_GUIDE.md)** — infrastructure, deployment, decisions
- **[Astro docs](https://docs.astro.build)** — full framework reference
- **[`src/content.config.ts`](src/content.config.ts)** — canonical schema for what frontmatter is allowed
- **[`AGENTS.md`](AGENTS.md)** — agent-oriented repo instructions (Claude Code, other AI assistants)
- **[`CLAUDE.md`](CLAUDE.md)** — Claude Code specific guidance

---

*This guide is the content-author's reference. If something isn't covered here and you find yourself looking it up more than once, add it here — capture for future-you.*
