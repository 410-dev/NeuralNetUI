// Firebase's google-services.json stays out of the (public) repository. Point GOOGLE_SERVICES_JSON at it when
// building; without it the app builds and runs, only without push notifications.
const fs = require("fs");

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesFile && !fs.existsSync(googleServicesFile)) throw new Error(`GOOGLE_SERVICES_JSON not found: ${googleServicesFile}`);
  // The page compares this with the server's key and warns when they belong to different Firebase projects.
  const firebaseProjectId = googleServicesFile ? JSON.parse(fs.readFileSync(googleServicesFile, "utf8")).project_info?.project_id : undefined;
  return { ...config, android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) }, extra: { ...config.extra, firebaseProjectId } };
};
