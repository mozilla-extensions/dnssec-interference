"use strict";
/* exported udpsocket */
/* global Components, ChromeUtils, ExtensionCommon, ExtensionAPI */

const Cc = Components.classes;
const Ci = Components.interfaces;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { EventManager} = ExtensionCommon;

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        udpsocket: {
          /**
           * Send a DNS query stored in buf to a nameserver addresses by addr 
           * over a UDP socket
           */
          async sendDNSQuery(addr, buf, rrtype) {
            let written;
            let responseBytes = [];
            let socket = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
            try {
                // Initialize the UDP socket
                socket.init2("0.0.0.0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);
                console.log(rrtype + " socket initialized on " + socket.localAddr.address + ":" + socket.port);

                // Set up a Promise that resolves when we get a response on the UDP socket
                responseBytes = await new Promise((resolve, reject) => {
                    socket.asyncListen({
                        QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                        onPacketReceived(aSocket, aMessage) {
                            console.log(rrtype + " packet received");
                            resolve(aMessage.rawData);
                        },
                        onStopListening(aSocket, aStatus) {}
                    }); 
                   
                    written = socket.send(addr, 53, buf);
                    if (written != buf.length) {
                        throw new ExtensionError("UDP socket didn't write expected number of bytes");
                    }
                });
                return responseBytes;
            } catch(e) {
                throw new ExtensionError(e.message);
            } finally {
                socket.close();
            }
            return responseBytes;
          },
        },
      },
    };
  }
};
