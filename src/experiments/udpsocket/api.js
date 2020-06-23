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
          async connect(buf, callback) {
            socket.init(-1, false, Services.scriptSecurityManager.getSystemPrincipal());
            console.log("UDP socket initialized on port " + socket.port);

            socket.asyncListen({
                QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                onPacketReceived(aSocket, aMessage) {
                    console.log(aMessage.rawData);
                    socket.close();
                },
                onStopListening(aSocket, aStatus) {},
            });

            let written = socket.send("8.8.8.8", 53, buf);
            console.log(written);
          }
        },
      },
    };
  }
};
