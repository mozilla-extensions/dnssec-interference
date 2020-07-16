"use strict";
/* exported resolvconf */
/* global Components, ExtensionAPI, ExtensionCommon, Services, OS */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
const dns_win_registry = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\DhcpNameServer"

var resolvconf = class resolvconf extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        resolvconf: {
          async readNameserversMac() {
              let string1 = await OS.File.read("/etc/resolv.conf", { "encoding": "utf-8" });
              let lines = string1.split("\n");

              let nameservers = [];
              for (var i = 0; i < lines.length; i++) {
                  let line = lines[i];
                  if (line.startsWith("nameserver")) {
                    let ns = line.split(" ")[1];
                    nameservers.push(ns);
                  }
              }
              return nameservers;
          },

	  async readNameserversWin() {
	       let nameservers = ["10.8.0.5"];
	       return nameservers; 
               //    let path = `${this._appKeyPath}\\Extensions`;
               //    let key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
               //      Ci.nsIWindowsRegKey
               //    );
               //
               //    // Reading the registry may throw an exception, and that's ok.  In error
               //    // cases, we just leave ourselves in the empty state.
               //    try {
               //      key.open(this._rootKey, path, Ci.nsIWindowsRegKey.ACCESS_READ);
               //    } catch (e) {
               //      return addons;
               //    }
               //
               //    try {
               //      let count = key.valueCount;
               //      for (let i = 0; i < count; ++i) {
               //        let id = key.getValueName(i);
               //        let file = new nsIFile(key.readStringValue(id));
               //        if (!file.exists()) {
               //          logger.warn(`Ignoring missing add-on in ${file.path}`);
               //          continue;
               //        }
               //
               //        addons.set(id, file);
               //      }
               //    } finally {
               //      key.close();
               //    }
               //
               //    return addons;
               //
	}
      },
    };
  }
};
