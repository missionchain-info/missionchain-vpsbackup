/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '187.77.149.158',
        port: '3001',
        pathname: '/images/**',
      },
    ],
  },
}

module.exports = nextConfig
