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
          openSocket(useIPv6) {
            let localAddr;
            if (useIPv6 == true) {
                localAddr = "::0";
            } else {
                localAddr = "0.0.0.0";
            }
            socket.init2(localAddr, -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
            console.log(socket.localAddr);
            console.log("UDP socket initialized on " + socket.localAddr + ":" + socket.port);
          },

          onDNSResponseReceived: new EventManager({
              context,
              name: "experiments.udpsocket.onDNSResponseReceived",
              register: fire => {
                const callback = value => {
                    fire.async(value);
                };
                socket.asyncListen({
                    QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                    onPacketReceived(aSocket, aMessage) {
                        callback(aMessage.rawData);
                    },
                    onStopListening(aSocket, aStatus) {},
                });
                return () => {
                    socket.close();
                }
              }
          }).api(),

          sendDNSQuery(addr, buf) {
              let written = socket.send(addr, 53, buf);
              console.log(addr, written);
          },
        },
      },
    };
  }
};
