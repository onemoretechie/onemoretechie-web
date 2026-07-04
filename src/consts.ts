// Site-wide constants for OneMoreTechie.
// Change once here, references propagate site-wide via imports.

export const SITE_TITLE = 'OneMoreTechie';
export const SITE_TAGLINE = 'Learn. Build. Ship. One tutorial at a time.';
export const SITE_DESCRIPTION =
  'Practical, hands-on tutorials on AWS, DevOps, Cloud Architecture, Security and IaC — written by a Principal Cloud Architect for engineers who ship to production.';

export const SITE_URL = 'https://onemoretechie.com';

// Author identity for the educator brand (kept separate from PRIT Cloud consulting identity).
export const AUTHOR = {
  name: 'Chandramani Tiwari',
  role: 'Principal Cloud Architect · DevSecOps Lead',
  bio: 'Sharing production-grade guidance across AWS, DevOps, Cloud Architecture, Security and IaC — the topics I work with daily.',
};

// Social + brand surfaces
export const SOCIAL = {
  youtube: 'https://youtube.com/@onemoretechie',
  github: 'https://github.com/onemoretechie',
  linkedin: 'https://linkedin.com/in/onemoretechie',
  twitter: 'https://twitter.com/onemoretechie',
  email: 'hello@onemoretechie.com',
};

// The 5 durable topic pillars — matches the locked taxonomy.
// Adding a new pillar = add an entry here + a matching .md file in src/content/topics/.
export const TOPIC_PILLARS = [
  { slug: 'aws', label: 'AWS', color: 'orange', icon: '☁' },
  { slug: 'devops', label: 'DevOps & CI/CD', color: 'cyan', icon: '⚙' },
  { slug: 'architecture', label: 'Cloud Architecture', color: 'purple', icon: '⬡' },
  { slug: 'security', label: 'Security', color: 'red', icon: '🔒' },
  { slug: 'iac-kubernetes', label: 'IaC & Kubernetes', color: 'blue', icon: '📦' },
] as const;

// Homepage stat callouts — kept honest to the actual brand claims
export const HERO_STATS = [
  { value: '5', suffix: '', label: 'Topic Pillars' },
  { value: '10', suffix: '+', label: 'Yrs Experience' },
  { value: '3', suffix: 'x', label: 'Certified' },
  { value: 'AU·UK·US', suffix: '', label: 'Multi-Region' },
];
