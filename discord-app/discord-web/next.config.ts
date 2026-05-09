import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dis/types", "@dis/api", "@dis/ws", "@dis/store"],
};

export default nextConfig;
