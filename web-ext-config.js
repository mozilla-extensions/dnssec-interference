/* eslint-env node */

const defaultConfig = {
  sourceDir: "./src/",
  ignoreFiles: [".DS_Store", "dns-test.js"],
  build: {
    overwriteDest: true,
  }
};

module.exports = defaultConfig;
