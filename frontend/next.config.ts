import type { NextConfig } from 'next';

const backend = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Semua panggilan /api/* diteruskan ke layanan oracle/backend (satu origin, tanpa CORS).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
