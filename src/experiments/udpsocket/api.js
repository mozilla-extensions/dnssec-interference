"use strict";
/* exported udpsocket */
/* global Components, Services */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

const socket = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        udpsocket: {
          async connect() {
            socket.init(-1, false, Services.scriptSecurityManager.getSystemPrincipal());
            console.log("UDP socket initialized on port " + socket.port);
            socket.close();
            console.log("UDP socket closed");
          },
        },
      },
    };
  }
};
