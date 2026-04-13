// Dev environment configuration — copied as config.js during dev deployment (localhost uses config.js with USE_EMULATORS)
// Copy this to config.js and replace <DEV_FIREBASE_API_KEY> with the real key
window.PORTAL_CONFIG = {
  API_BASE: "https://dev-api.shytalk.shyden.co.uk", // localhost: http://localhost:3000
  FIREBASE_CONFIG: {
    apiKey: "<DEV_FIREBASE_API_KEY>",
    authDomain: "shytalk-dev.firebaseapp.com",
    projectId: "shytalk-dev"
  }
};
