"use strict";
/* exported tcpsocket */
/* global Components, ExtensionAPI, ExtensionCommon, Services */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { TCPSocket } = Cu.getGlobalForObject(
    ChromeUtils.import("resource://gre/modules/Services.jsm")
);
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

/**
 * Helper method to add event listeners to a socket and provide two Promise-returning
 * helpers (see below for docs on them).  This *must* be called during the turn of
 * the event loop where TCPSocket's constructor is called or the onconnect method is being
 * invoked.
 */
function listenForEventsOnSocket(socket, socketType) {
  let wantDataLength = null;
  let wantDataAndClose = false;
  let pendingResolve = null;
  let receivedEvents = [];
  let receivedData = null;
  let handleGenericEvent = function(event) {
    console.log("(" + socketType + " event: " + event.type + ")\n");
    if (pendingResolve && wantDataLength === null) {
      pendingResolve(event);
      pendingResolve = null;
    } else {
      receivedEvents.push(event);
    }
  };

  socket.onopen = handleGenericEvent;
  socket.ondrain = handleGenericEvent;
  socket.onerror = handleGenericEvent;
  socket.onclose = function(event) {
    if (!wantDataAndClose) {
      handleGenericEvent(event);
    } else if (pendingResolve) {
      console.log("(" + socketType + " event: close)\n");
      pendingResolve(receivedData);
      pendingResolve = null;
      wantDataAndClose = false;
    }
  };
  socket.ondata = function(event) {
    console.log(
      "(" +
        socketType +
        " event: " +
        event.type +
        " length: " +
        event.data.byteLength +
        ")\n"
    );
    // ok(
    //   socketCompartmentInstanceOfArrayBuffer(event.data),
    //   "payload is ArrayBuffer"
    // );
    var arr = new Uint8Array(event.data);
    if (receivedData === null) {
      receivedData = arr;
    } else {
      receivedData = concatUint8Arrays(receivedData, arr);
    }
    if (wantDataLength !== null && receivedData.length >= wantDataLength) {
      pendingResolve(receivedData);
      pendingResolve = null;
      receivedData = null;
      wantDataLength = null;
    }
  };

  return {
    /**
     * Return a Promise that will be resolved with the next (non-data) event
     * received by the socket.  If there are queued events, the Promise will
     * be immediately resolved (but you won't see that until a future turn of
     * the event loop).
     */
    waitForEvent() {
      if (pendingResolve) {
        throw new Error("only one wait allowed at a time.");
      }

      if (receivedEvents.length) {
        return Promise.resolve(receivedEvents.shift());
      }

      console.log("(" + socketType + " waiting for event)\n");
      return new Promise(function(resolve, reject) {
        pendingResolve = resolve;
      });
    },
    /**
     * Return a Promise that will be resolved with a Uint8Array of at least the
     * given length.  We buffer / accumulate received data until we have enough
     * data.  Data is buffered even before you call this method, so be sure to
     * explicitly wait for any and all data sent by the other side.
     */
    waitForDataWithAtLeastLength(length) {
      if (pendingResolve) {
        throw new Error("only one wait allowed at a time.");
      }
      if (receivedData && receivedData.length >= length) {
        let promise = Promise.resolve(receivedData);
        receivedData = null;
        return promise;
      }
      console.log("(" + socketType + " waiting for " + length + " bytes)\n");
      return new Promise(function(resolve, reject) {
        pendingResolve = resolve;
        wantDataLength = length;
      });
    },
    waitForAnyDataAndClose() {
      if (pendingResolve) {
        throw new Error("only one wait allowed at a time.");
      }

      return new Promise(function(resolve, reject) {
        pendingResolve = resolve;
        // we may receive no data before getting close, in which case we want to
        // return an empty array
        receivedData = new Uint8Array();
        wantDataAndClose = true;
      });
    },
  };
}


var tcpsocket = class tcpsocket extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        tcpsocket: {
          async openSocket() {
            let clientSocket = new TCPSocket("10.8.0.5", 53, {
                binaryType: "arraybuffer",
            });
            let clientQueue = listenForEventsOnSocket(clientSocket, "client");
            console.log("Socket initiated");

            // (the client connects)
            let nextEvent = (await clientQueue.waitForEvent()).type;
            if (nextEvent == "open" && clientSocket.readyState == "open") {
                console.log("client opened socket and readyState is open");
            } else {
                throw new Error("Could not open TCP socket");
            }
          },

          onDNSResponseReceived: new EventManager({
              context,
              name: "experiments.tcpsocket.onDNSResponseReceived",
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
