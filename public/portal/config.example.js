// Production environment configuration (localhost uses config.js with USE_EMULATORS)
// Copy this to config.js and replace <PROD_FIREBASE_API_KEY> with the real key
window.PORTAL_CONFIG = {
  API_BASE: "https://api.shytalk.shyden.co.uk", // localhost: http://localhost:3000
  FIREBASE_CONFIG: {
    apiKey: "<PROD_FIREBASE_API_KEY>",
    authDomain: "shytalk-7ba69.firebaseapp.com",
    projectId: "shytalk-7ba69"
  }
};
