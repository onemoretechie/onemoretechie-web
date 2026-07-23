# MAINTAINER_GUIDE — onemoretechie.com

**Internal document. Not published to the live site.** Lives at repo root, not under `src/`, so Astro doesn't include it in the build.

Future-you reference: what's here, how the site is deployed, what NOT to do, what's known broken, and the planned roadmap. Read this before making changes when you've been away from the project for more than a couple of weeks.

For content authoring (adding a blog post, topic pillar), see **[CONTRIBUTING.md](CONTRIBUTING.md)**. That's the author's guide. This is the maintainer's guide — infra, decisions, architecture.

---

## 1. Site architecture (15-second mental model)

```
github.com/onemoretechie/onemoretechie-web   (public repo)
   │
   ▼   git push triggers auto-deploy
   │
Cloudflare Workers Builds
   ├── npm install
   ├── npm run build           →  produces ./dist/  (Astro's static output)
   └── npx wrangler deploy     →  uploads ./dist/ + any Worker code
   │
   ▼
onemoretechie.com (custom domain)
   └── Cloudflare Workers Static Assets serves everything from ./dist/
```

- **Domain registrar**: (verify) — typically Cloudflare Registrar or GoDaddy
- **DNS**: Cloudflare (nameservers registered under the `onemoretechie` Cloudflare account)
- **Email Routing**: Cloudflare Email Routing → forwards to Gmail (specifics kept out of this file for privacy; check Cloudflare dashboard)
- **Hosting**: Cloudflare Workers Static Assets (free tier, unlimited bandwidth)
- **Source of truth**: this git repo (`onemoretechie/onemoretechie-web`, public)

---

## 2. File / folder structure

```
onemoretechie-web/
├── astro.config.mjs                       ← Astro config (site URL, integrations, fonts)
├── package.json                            ← dependencies + scripts
├── tsconfig.json
├── wrangler.toml                           ← Cloudflare Workers deploy config (if present)
├── CLAUDE.md                               ← Claude Code repo instructions
├── AGENTS.md                               ← agent-oriented repo instructions
├── CONTRIBUTING.md                         ← content-author guide (this file's sibling)
├── MAINTAINER_GUIDE.md                     ← (this file)
├── README.md
│
├── public/                                 ← static assets served as-is
│   ├── favicon.svg
│   ├── robots.txt
│   └── ...
│
├── src/
│   ├── content/
│   │   ├── blog/                           ← blog posts (.md + .mdx)
│   │   └── topics/                         ← 5 pillar pages
│   ├── content.config.ts                   ← zod schemas for both collections
│   ├── consts.ts                           ← site constants (name, description, TOPIC_PILLARS)
│   ├── pages/                              ← Astro routes
│   │   ├── index.astro                     ← homepage
│   │   ├── blog/
│   │   │   └── [...slug].astro             ← blog post routes
│   │   ├── topics/
│   │   │   └── [slug].astro                ← topic pillar routes
│   │   ├── about.astro
│   │   ├── contact.astro
│   │   ├── rss.xml.js                      ← RSS feed generator
│   │   └── 404.astro
│   ├── layouts/                            ← page shells (BlogLayout, TopicLayout, etc.)
│   ├── components/                         ← reusable UI (BlogCard, TopicCard, etc.)
│   ├── styles/                             ← global CSS + design tokens
│   └── assets/                             ← images referenced from content (Astro-optimized)
│
├── dist/                                   ← Astro build output; deployed by wrangler
│                                              (gitignored; rebuilt on every deploy)
│
└── node_modules/                           ← npm deps; gitignored
```

`dist/` is what Cloudflare serves. Everything outside `dist/` (source `.astro` + `.md` files, `AGENTS.md`, `MAINTAINER_GUIDE`, config files) is **not** publicly accessible.

---

## 3. Stack + integrations

- **Framework**: Astro 5 (or 7, depending on `package.json` — verify)
- **Content collections**: `@astrojs/content` via `defineCollection` + zod
- **MDX**: `@astrojs/mdx` for `.mdx` files with JSX
- **RSS**: `@astrojs/rss` — feed at `/rss.xml`
- **Sitemap**: `@astrojs/sitemap` — generated at build time
- **Images**: `sharp` for optimization
- **Fonts**: Outfit (body) + JetBrains Mono (code), self-hosted via Astro's Google Fonts provider

---

## 4. Common workflows

### 4.1 Add a new blog post

Full step-by-step in **[CONTRIBUTING.md](CONTRIBUTING.md)**. TL;DR:

1. Drop `your-post.md` into `src/content/blog/`
2. Include required frontmatter (title, description, pubDate, topic, type)
3. Commit + push
4. Cloudflare auto-builds in ~60 seconds

### 4.2 Add a new topic pillar

The 5 pillars are locked (aws, devops, architecture, security, iac-kubernetes). Adding a 6th requires:

1. Add slug to enum in `src/content.config.ts` (both `blog.topic` and `topics.slug`)
2. Add entry to `TOPIC_PILLARS` in `src/consts.ts`
3. Create `src/content/topics/<slug>.md` with topic frontmatter
4. Verify grid layout on homepage — pillar count affects visual balance

### 4.3 Update site metadata

Edit `src/consts.ts`:

```typescript
export const SITE_TITLE = 'OneMoreTechie';
export const SITE_DESCRIPTION = '...';
```

Or update `astro.config.mjs` for the canonical `site:` URL.

### 4.4 Add a new page (not blog / topic)

Create `src/pages/<name>.astro`. Use an existing layout:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Page Title">
  <h1>Content</h1>
</BaseLayout>
```

Astro auto-routes: `src/pages/foo.astro` → `/foo/`.

### 4.5 Change fonts / colors / design tokens

Design tokens live in `src/styles/`. Global CSS custom properties (e.g., `--color-accent: #22D3C8`).

Font providers configured in `astro.config.mjs` — swap here to change Outfit / JetBrains Mono. Test both light + dark modes after changes.

### 4.6 Update the homepage

`src/pages/index.astro`. Uses `src/consts.ts` for the topic pillar grid + latest blog posts.

### 4.7 Deploy manually (bypass auto-deploy)

Rarely needed; but if Cloudflare Builds is failing:

```bash
npm install
npm run build
npx wrangler deploy
```

Requires local Cloudflare authentication (`npx wrangler login`).

---

## 5. Deployment

Cloudflare Workers Builds triggers on every push to `main`:

1. Clone repo
2. `npm install`
3. `npm run build` — Astro produces `./dist/`
4. `npx wrangler deploy` — uploads `./dist/` + Worker code

Build takes ~2-4 minutes. Check status: Cloudflare dashboard → **Workers & Pages** → onemoretechie → **Deployments**.

**If a build fails:** check the build logs. Common causes:
- Zod schema validation error (missing required frontmatter)
- Broken markdown link (Astro can catch these)
- Missing image referenced from content
- npm dependency mismatch (rare, usually surfaces after lockfile updates)

---

## 6. Content model (canonical reference)

Defined in `src/content.config.ts`:

### Blog collection

Required frontmatter:

| Field | Type | Notes |
|---|---|---|
| `title` | string | Post title |
| `description` | string | Meta description + social card text |
| `pubDate` | date | Coerced from string; use YYYY-MM-DD |
| `topic` | enum | One of: aws, devops, architecture, security, iac-kubernetes |
| `type` | enum | One of: tutorial, runbook, architecture-doc, cheat-sheet, interview-qa, study-notes (default: tutorial) |

Optional:

| Field | Type | Notes |
|---|---|---|
| `updatedDate` | date | For updated posts |
| `heroImage` | image | Astro-optimized image import |
| `heroImageAlt` | string | Required if heroImage present |
| `youtube_url` | URL | Renders YouTube card on the post |
| `github_repo` | URL | Renders GitHub source card |
| `github_path` | string | Sub-path inside the repo |
| `tags` | string[] | Free-form tags |
| `draft` | boolean | Default false; if true, hidden from prod |

### Topics collection

Required frontmatter:

| Field | Type | Notes |
|---|---|---|
| `title` | string | Pillar title |
| `description` | string | Pillar description |
| `slug` | enum | Must match one of the 5 pillars |
| `color` | enum | One of: orange, cyan, purple, red, blue, green, amber |

---

## 7. What NOT to add

Standing constraints to respect:

### Content
- Personal identity linkage — never tie chandramanit-owned assets to OMT ownership publicly. See the [four-brand isolation policy](../../PRIT_Cloud/web/MAINTAINER_GUIDE.md) for context.
- Corporate email references (`inxpress.com` etc.) — OMT is a separate venture
- Cross-linking to ORATechno or PRIT Cloud in a way that reveals shared ownership

### Technical
- Live chat widget
- AI chatbot
- Comment system (Disqus / Giscus / similar)
- Google Analytics or Hotjar — use Cloudflare Web Analytics if measurement is needed
- Newsletter signup that captures email — changes privacy posture significantly
- User accounts / login
- Paid content / paywalls
- Multi-language builds — English-only for now

### Deployment
- Don't push to `main` without local `npm run build` verification for complex changes
- Don't add new npm dependencies without justification — each dep is a supply-chain surface
- Don't modify `dist/` directly — it's regenerated on every build
- Don't commit `node_modules/` or `dist/` — both are gitignored

---

## 8. Maintenance cadence

| Frequency | Task |
|---|---|
| **Weekly** | If active blog cadence, check any form submissions / RSS subscriber count |
| **Monthly** | Cloudflare Web Analytics review — traffic patterns, top posts, 404s |
| **Quarterly** | Astro / dependencies update — `npm outdated` → carefully bump; test locally + preview build; commit |
| **Annually** | Domain renewal check (~3 months before expiry); Privacy Policy re-read; brand messaging audit |
| **As needed** | Publish new blog posts per CONTRIBUTING.md; respond to GitHub issues |

---

## 9. Roadmap items (see also ROADMAP.md if present)

Open items — none of these block current operation:

- **RSS feed customization** — currently default @astrojs/rss output; consider adding topic-filtered feeds (`/rss/aws.xml`, etc.)
- **Newsletter integration** — deliberately deferred (see "What NOT to add")
- **Search** — could add Pagefind (static-search plugin) if content grows past ~30 posts
- **Comments** — deliberately deferred
- **Video content** — YouTube integration exists (`youtube_url` frontmatter); no first-party video hosting

---

## 10. Adjacent references

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — content-author guide (day-to-day)
- **[AGENTS.md](AGENTS.md)** — agent-oriented repo instructions
- **[CLAUDE.md](CLAUDE.md)** — Claude Code repo instructions
- **[README.md](README.md)** — public-facing project intro
- **[Astro docs](https://docs.astro.build)** — framework reference
- **[Astro content collections](https://docs.astro.build/en/guides/content-collections/)** — schema + collection docs

---

## 11. Cross-brand context

OMT is one of four brands operated independently. Standing policy (2026-06-30):

- **chandramanit** — personal identity + [ORATechno](https://oratechno.com) (single-hosted exception)
- **PRIT Cloud** — cloud advisory brand (arm's-length) — [pritcloud.com](https://pritcloud.com)
- **OneMoreTechie** — educator's brand (this repo) — [onemoretechie.com](https://onemoretechie.com)
- **ORATechno** — Oracle reference site — [oratechno.com](https://oratechno.com)

Each has its own GitHub account, Cloudflare account, domain, and email. Never cross-reference between brands publicly. Sibling MAINTAINER_GUIDEs live in each brand's repo.

---

*This document supersedes any spoken/verbal decisions. If something isn't captured here, either it's not decided or it's in flux — verify before acting.*
