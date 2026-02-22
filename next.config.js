/** @type {import('next').NextConfig} */
const nextConfig = {
  // 让 ali-oss 等 Node.js 原生 SDK 在服务端直接运行，不经过 Turbopack 打包
  serverExternalPackages: ['ali-oss', 'proxy-agent', 'urllib'],
}

module.exports = nextConfig
