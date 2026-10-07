// app.json holds the app's settings. When the live workspace is built for the web and
// served by the backend at /workspace (scripts/build-workspace-web.mjs), its files must
// be addressed under that path, so the build sets RECHARGE_WEB_BASE_URL=/workspace.
module.exports = ({ config }) => {
  const baseUrl = process.env.RECHARGE_WEB_BASE_URL;
  return baseUrl ? { ...config, experiments: { ...config.experiments, baseUrl } } : config;
};
