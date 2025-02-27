/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export in production mode
  ...(process.env.NODE_ENV === 'production' ? { 
    output: 'export',
    distDir: 'out',
  } : {}),
  images: {
    unoptimized: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  // Disable TypeScript type checking during build
  typescript: {
    ignoreBuildErrors: true,
  },
  // Skip API routes during static export
  experimental: {
    outputFileTracingExcludes: {
      '*': [
        'node_modules/@swc/core-linux-x64-gnu',
        'node_modules/@swc/core-linux-x64-musl',
        'node_modules/@esbuild/linux-x64',
      ],
    },
  },
  // Exclude API routes from the build
  webpack: (config, { isServer }) => {
    // Only on the client side
    if (!isServer) {
      // Don't attempt to bundle API routes for client-side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig 