import type { NextConfig } from 'next';

// Backend origins stay server-side: the browser calls same-origin paths and these
// rewrites forward them, so neither backend needs CORS and the session cookie
// stays first-party.
const AUTH_API_BASE_URL =
  process.env.AUTH_API_BASE_URL ?? 'http://localhost:10010';
// The transactions service is served under /transactions-api (its spec omits the prefix).
const TRANSACTIONS_API_BASE_URL =
  process.env.TRANSACTIONS_API_BASE_URL ??
  'http://localhost:10005/transactions-api';

const nextConfig: NextConfig = {
  // Emit a minimal, self-contained server bundle in `.next/standalone`
  // so the Docker runtime image only needs Node + the traced dependencies.
  output: 'standalone',
  // Stop `next dev` writing web/AGENTS.md; the "Check Next.js APIs in the Installed Docs"
  // rule in CLAUDE.md points agents at the bundled Next.js docs instead.
  agentRules: false,
  async rewrites() {
    return [
      {
        source: '/v1/auth/:path*',
        destination: `${AUTH_API_BASE_URL}/v1/auth/:path*`,
      },
      {
        source: '/v1/health',
        destination: `${AUTH_API_BASE_URL}/v1/health`,
      },
      {
        source: '/transactions-api/:path*',
        destination: `${TRANSACTIONS_API_BASE_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
