import "dotenv/config";
import { devConfig } from "./config.dev.js";
import { prodConfig } from "./config.prod.js";

const environment = process.env.NODE_ENV || "development";
const envConfig = environment === "production" ? prodConfig : devConfig;
const isProduction = environment === "production";

const commonConfig = {
  prefix: ".",
  ownerIds: ["931059762173464597", "1446391627638902865"],

  colors: {
    bot: [214, 211, 203],
    error: [230, 190, 175],
    success: [140, 200, 170],
    warn: [255, 190, 120],
  },
  links: {
    supportServer: "https://discord.gg/Ez4gCJQDxB",
    invite:
      "https://discord.com/oauth2/authorize?client_id=1277525844319014955&permissions=4820258979704064&integration_type=0&scope=bot+applications.commands",
  },
  watermark: "coded by bre4d",
  version: "2.0.0",
};

export const config = {
  ...commonConfig,
  ...envConfig,
  environment,
};
