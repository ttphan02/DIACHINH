import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({});
config.buildCommand = "npx next build --webpack";

export default config;
