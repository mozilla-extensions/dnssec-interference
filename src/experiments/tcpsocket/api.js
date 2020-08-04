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

var tcp_socket;
var tcp_event_queue;

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
    console.log(event);
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
          async test(buf) {
            // Instantiate socket/event queue
            tcp_socket = new TCPSocket("8.8.8.8", 53, { binaryType: "arraybuffer" });
            tcp_event_queue = listenForEventsOnSocket(tcp_socket, "client");
           
            // Wait until the socket has opened a connection to the DNS server
            let nextEvent = (await tcp_event_queue.waitForEvent()).type;
            if (nextEvent == "open" && tcp_socket.readyState == "open") {
                console.log("client opened socket and readyState is open");
            } else {
                throw new Error("Could not open TCP socket");
            }

            console.log(tcp_socket.readyState);

            // console.log("Before send");
            // tcp_socket.send(buf.buffer, buf.byteOffset, buf.byteLength);
            // console.log("After send");
            // let answer = await tcp_event_queue.waitForDataWithAtLeastLength(5);
            // console.log("After answer");
          }
        },
      },
    };
  }
};
