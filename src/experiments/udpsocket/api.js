"use strict";
/* exported udpsocket */
/* global Components, ExtensionAPI, ExtensionCommon, Services */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { EventManager} = ExtensionCommon;

const socket_ipv4_a         = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_aaaa      = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_rrsig     = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_dnskey    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_smimea    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_https     = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_newone    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_newtwo    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);

const sockets_ipv4 = {"A":      socket_ipv4_a,
                      "RRSIG":  socket_ipv4_rrsig,
                      "DNSKEY": socket_ipv4_dnskey, 
                      "SMIMEA": socket_ipv4_smimea,
                      "HTTPS":  socket_ipv4_https,
                      "NEWONE": socket_ipv4_newone,
                      "NEWTWO": socket_ipv4_newtwo}

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        udpsocket: {
          openSocket() {
            for (const rrtype in sockets_ipv4) {
              let socket = sockets_ipv4[rrtype];
              socket.init2("0.0.0.0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
              console.log(rrtype + " socket initialized on " + socket.localAddr.address + ":" + socket.port);
            }
          },

          onDNSResponseReceived: new EventManager({
              context,
              name: "experiments.udpsocket.onDNSResponseReceived",
              register: fire => {
                const callback = (rawData, rrtype, usedIPv4) => {
                    fire.async(rawData, rrtype, usedIPv4);
                };
                for (const rrtype in sockets_ipv4) {
                    let socket = sockets_ipv4[rrtype];
                    socket.asyncListen({
                        QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                        onPacketReceived(aSocket, aMessage) {
                            console.log(rrtype + " packet received");
                            callback(aMessage.rawData, rrtype, true);
                        },
                        onStopListening(aSocket, aStatus) {}
                    });
                }
                return () => {
                    console.log("Closing sockets");
                    for (const rrtype in sockets_ipv4) {
                        let socket = sockets_ipv4[rrtype];
                        socket.close()
                    }
                }
              }
          }).api(),

          sendDNSQuery(addr, buf, rrtype, useIPv4) {
            let written;
            if (useIPv4) {
              let socket = sockets_ipv4[rrtype];
              written = socket.send(addr, 53, buf, buf.length);
              console.log(addr, written);
            }
            return written;
          },
        },
      },
    };
  }
};
