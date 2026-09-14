/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep production builds from replacing chunks used by a running dev server.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
