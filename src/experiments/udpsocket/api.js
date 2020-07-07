"use strict";
/* exported udpsocket */
/* global Components, ExtensionAPI, ExtensionCommon, Services */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { EventManager} = ExtensionCommon;

const socket_ipv4 = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv6 = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        udpsocket: {
          openSocket() {
            socket_ipv4.init2("0.0.0.0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
            socket_ipv6.init2("::0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
            console.log("IPv4 UDP socket initialized on " + socket_ipv4.localAddr.address + ":" + socket_ipv4.port);
            console.log("IPv6 UDP socket initialized on " + socket_ipv6.localAddr.address + ":" + socket_ipv6.port);
          },

          onDNSResponseReceived: new EventManager({
              context,
              name: "experiments.udpsocket.onDNSResponseReceived",
              register: fire => {
                const callback = value => {
                    fire.async(value);
                };
                socket_ipv4.asyncListen({
                    QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                    onPacketReceived(aSocket, aMessage) {
                        console.log("IPv4 packet received");
                        callback(aMessage.rawData);
                    },
                    onStopListening(aSocket, aStatus) {}
                });
                socket_ipv6.asyncListen({
                    QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                    onPacketReceived(aSocket, aMessage) {
                        console.log("IPv6 packet received");
                        callback(aMessage.rawData);
                    },
                    onStopListening(aSocket, aStatus) {}
                });
                return () => {
                    console.log("Closing addon");
                    socket_ipv4.close();
                    socket_ipv6.close();
                }
              }
          }).api(),

          async sendDNSQuery(addr, buf, useIPv4) {
              let written;
              if (useIPv4 == true) {
                written = await socket_ipv4.send(addr, 53, buf, buf.length);
              } else {
                written = await socket_ipv6.send(addr, 53, buf, buf.length);
              }
              console.log(addr, written);
          },
        },
      },
    };
  }
};
