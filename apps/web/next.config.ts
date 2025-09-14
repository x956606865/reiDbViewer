import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

// Ensure stable root detection in monorepo/parent-lockfile setups
const __dirname2 = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.join(__dirname2, '..', '..')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Use standalone output for smaller Docker images per Next.js guidance.
  output: 'standalone',
  // v15: typedRoutes moved out of experimental
  typedRoutes: true,
  // Silence and fix root autodetect warning when multiple lockfiles exist
  outputFileTracingRoot: workspaceRoot,
}

export default nextConfig
