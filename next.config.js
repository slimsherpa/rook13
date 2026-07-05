/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Firebase Hosting: `next build` writes the site to out/
  output: 'export',
  images: {
    unoptimized: true,
  },
  eslint: {
    // We run eslint/tsc separately; don't fail the production build on lint.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
