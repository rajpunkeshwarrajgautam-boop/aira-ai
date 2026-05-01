/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "@prisma/client",
    "axios",
    "openai",
    "pg",
    "prisma",
    "zod",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.google.com",
        pathname: "/s2/favicons/**",
      },
    ],
  },
};

export default nextConfig;
