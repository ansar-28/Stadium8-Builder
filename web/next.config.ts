import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a minimal, self-contained server bundle in `.next/standalone`
  // so the Docker runtime image only needs Node + the traced dependencies.
  output: 'standalone',
  // Stop `next dev` writing web/AGENTS.md; the "Check Next.js APIs in the Installed Docs"
  // rule in CLAUDE.md points agents at the bundled Next.js docs instead.
  agentRules: false,
};

export default nextConfig;
