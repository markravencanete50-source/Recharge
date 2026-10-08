// app.json holds the app's settings. When the live workspace is built for the web and
// served by the backend at /workspace (scripts/build-workspace-web.mjs), its files must
// be addressed under that path, so the build sets RECHARGE_WEB_BASE_URL=/workspace.
// The live build (RECHARGE_LIVE_ONLY) is the real app, so its browser tab says "Recharge"; the sample
// preview keeps its own name.
module.exports = ({ config }) => {
  const baseUrl = process.env.RECHARGE_WEB_BASE_URL;
  const live = process.env.RECHARGE_LIVE_ONLY === "1";
  const named = live ? { ...config, name: "Recharge", web: { ...config.web, name: "Recharge", shortName: "Recharge", description: "Properties, stays, cleans, repairs and accounts in one app." } } : config;
  return baseUrl ? { ...named, experiments: { ...named.experiments, baseUrl } } : named;
};
