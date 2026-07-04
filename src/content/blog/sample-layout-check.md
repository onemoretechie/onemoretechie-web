---
title: Sample post — layout verification
description: Draft-only sample used to prove the BlogPost layout renders end-to-end with topic, type, YouTube link, GitHub link, and tags. Safe to delete once the layout is verified.
pubDate: 2026-07-05
topic: aws
type: tutorial
youtube_url: https://youtube.com/watch?v=dQw4w9WgXcQ
github_repo: https://github.com/onemoretechie/aws-infrastructure-as-code
github_path: /examples/multi-region-failover
tags: [ec2, route53, failover, multi-region]
draft: true
---

## Section heading

This is the sample post body. It exists to prove the layout renders correctly with all schema fields populated — topic pillar chip, content type badge, dual media buttons (YouTube + GitHub), tag pills, and the prose body.

### Sub-section

Some code:

```typescript
const failoverConfig = {
  primary: 'us-east-1',
  secondary: 'us-west-2',
  healthCheckId: 'abc-123',
};
```

A **bold** claim and an *italic* aside, plus [a link](https://onemoretechie.com/).

> A blockquote to test blockquote styling — should have the cyan accent border on the left.

### List

- List item one
- List item two
- List item three

A table:

| Region | Latency | Cost |
|---|---|---|
| us-east-1 | 12ms | $$$ |
| us-west-2 | 40ms | $$ |
| eu-west-1 | 90ms | $$ |

Done.
