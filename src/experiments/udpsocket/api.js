"use strict";
/* exported udpsocket */
/* global Components, ExtensionAPI, ExtensionCommon, Services */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { EventManager} = ExtensionCommon;

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
          },

          onSomething: new EventManager({
              context,
              name: "experiments.udpsocket.onSomething",
              register: fire => {
                const callback = value => {
                    fire.async(value);
                };
                socket.asyncListen({
                    QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                    onPacketReceived(aSocket, aMessage) {
                        callback(aMessage.rawData);
                        aSocket.close();
                    },
                    onStopListening(aSocket, aStatus) {},
                });
                return () => {
                    // Unregister callback
                }
              }
          }).api(),

          async send(addr, buf) {
              let written = socket.send(addr, 53, buf);
              console.log(written);
          }
        },
      },
    };
  }
};
