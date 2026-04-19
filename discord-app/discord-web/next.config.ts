import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@dis/types", "@dis/api", "@dis/ws", "@dis/store"],
  // discord-app/ is one level up — Turbopack watches shared/ from here
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
