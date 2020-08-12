"use strict";
/* exported udpsocket */
/* global Components, ChromeUtils, ExtensionCommon, ExtensionAPI */

const Cc = Components.classes;
const Ci = Components.interfaces;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { EventManager} = ExtensionCommon;

const socket_ipv4_a         = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_rrsig     = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_dnskey    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_smimea    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_https     = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_newone    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
const socket_ipv4_newtwo    = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);

const sockets_ipv4 = {A:      socket_ipv4_a,
                      RRSIG:  socket_ipv4_rrsig,
                      DNSKEY: socket_ipv4_dnskey, 
                      SMIMEA: socket_ipv4_smimea,
                      HTTPS:  socket_ipv4_https,
                      NEWONE: socket_ipv4_newone,
                      NEWTWO: socket_ipv4_newtwo}

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        udpsocket: {
          /**
           * Open one UDP socket per RR type so that we can keep track of which 
           * DNS responses we failed to receive
           */
          openSocket() {
            for (const rrtype in sockets_ipv4) {
              let socket = sockets_ipv4[rrtype];
              socket.init2("0.0.0.0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
              console.log(rrtype + " socket initialized on " + socket.localAddr.address + ":" + socket.port);
            }
          },
            
          /**
           * Event listener that responds to packets being received on our UDP 
           * sockets. We send the raw bytes for the UDP data to background.js
           */
          onDNSResponseReceived: new EventManager({
              context,
              name: "experiments.udpsocket.onDNSResponseReceived",
              register: fire => {
                const callback = (rawData, rrtype) => {
                    fire.async(rawData, rrtype);
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

          /**
           * Send a DNS query stored in buf to a nameserver addresses by addr 
           * over the corresponding UDP socket for the query's RR type
           */
          sendDNSQuery(addr, buf, rrtype) {
            let written;
            let socket = sockets_ipv4[rrtype];
            written = socket.send(addr, 53, buf, buf.length);
            console.log(addr, written);
            return written;
          },
        },
      },
    };
  }
};
