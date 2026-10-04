import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/scanname",
        destination: "/scanname/index.html",
      },
      {
        source: "/scanname/",
        destination: "/scanname/index.html",
      },
    ];
  },
};

export default nextConfig;
