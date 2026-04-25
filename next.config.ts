import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@chainlink/data-streams-sdk"],
  webpack: (config) => {
    // Prevent file watcher from triggering reloads when cycle logger
    // writes CSVs or config files inside (or near) the project directory.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: /(\/(tracked-wallets|\.wallettracker|node_modules)\/|\.tsbuildinfo$)/,
    };
    return config;
  },
};

export default nextConfig;
