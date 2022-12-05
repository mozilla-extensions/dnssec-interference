const { main } = require("./dns-test");

function addListeners() {
  browser.runtime.onInstalled.addListener(onInstalled);
  browser.runtime.onStartup.addListener(onStartup);
}
function removeListeners() {
  browser.runtime.onInstalled.removeListener(onInstalled);
  browser.runtime.onStartup.removeListener(onStartup);
}

function onInstalled() {
  main({ trigger: "install" });
  removeListeners();
}

function onStartup() {
  main({ trigger: "startup" });
  removeListeners();
}

addListeners();
