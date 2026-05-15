import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack is now stable in Next.js 16 — enabled via --turbopack CLI flag
  },
  async rewrites() {
    // Proxy API calls in dev so the frontend doesn't need CORS config
    return process.env['NODE_ENV'] === 'development'
      ? [
          {
            source: '/api/:path*',
            destination: 'http://localhost:4000/api/:path*',
          },
        ]
      : [];
  },
};

export default nextConfig;
