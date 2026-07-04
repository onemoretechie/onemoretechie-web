// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://onemoretechie.com',
  integrations: [mdx(), sitemap()],
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Outfit',
      cssVariable: '--font-outfit',
      fallbacks: ['system-ui', 'sans-serif'],
      weights: [300, 400, 500, 600, 700, 800],
    },
    {
      provider: fontProviders.google(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      fallbacks: ['Consolas', 'monospace'],
      weights: [400, 600],
    },
  ],
});
