import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Blog posts — the "how-to" and "tutorial" writing surface.
const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.optional(image()),
      // Which of the 5 pillars this post belongs to
      topic: z.enum(['aws', 'devops', 'architecture', 'security', 'iac-kubernetes']),
      // Content type — for filtering "how-to" vs "runbook" vs "interview" etc.
      type: z.enum(['tutorial', 'runbook', 'architecture-doc', 'cheat-sheet', 'interview-qa', 'study-notes']).default('tutorial'),
      // Optional media links surfaced as buttons at top & bottom of the post
      youtube_url: z.string().url().optional(),
      github_repo: z.string().url().optional(),
      github_path: z.string().optional(),
      // Free-form tags for finer discovery
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// Topic pillar pages — one per pillar, sits at /topics/<slug>/
const topics = defineCollection({
  loader: glob({ base: './src/content/topics', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      // Same slug as in TOPIC_PILLARS
      slug: z.enum(['aws', 'devops', 'architecture', 'security', 'iac-kubernetes']),
      // Color key drives the card tint on the homepage grid
      color: z.enum(['orange', 'cyan', 'purple', 'red', 'blue', 'green', 'amber']),
      icon: z.string(),
      order: z.number().default(99),
      heroImage: z.optional(image()),
      // Optional headline media surfaced at the top of the pillar page
      youtube_url: z.string().url().optional(),
      github_repo: z.string().url().optional(),
    }),
});

export const collections = { blog, topics };
