/** @type {import('next').NextConfig} */
module.exports = {
  output: 'standalone',
  transpilePackages: ['@missionchain/sdk'],
  reactStrictMode: true,
}
