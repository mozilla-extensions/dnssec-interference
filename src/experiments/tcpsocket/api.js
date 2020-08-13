"use strict";
/* exported tcpsocket */
/* global ExtensionAPI, ChromeUtils, Cu */

const { TCPSocket } = Cu.getGlobalForObject(
    ChromeUtils.import("resource://gre/modules/Services.jsm")
);

/**
 * Concatenate two Uint8Array objects
 */
function concatUint8Arrays(a, b) {
    let newArr = new Uint8Array(a.length + b.length);
    newArr.set(a, 0);
    newArr.set(b, a.length);
    return newArr;
}

var tcpsocket = class tcpsocket extends ExtensionAPI {
    getAPI(context) {
        return {
            experiments: {
                tcpsocket: {
                    /** 
                     * Send a DNS query stored in buf over a TCP socket to a 
                     * nameserver addressed by addr
                     */
                    async sendDNSQuery(addr, buf) {
                        let tcp_socket;

                        try {
                            // Wait until the socket is open before sending data.
                            // If we get an 'error' event before an 'open' event, 
                            // throw an ExtensionError.
                            tcp_socket = new TCPSocket(addr, 53, { binaryType: "arraybuffer" });
                            let eventType = await new Promise((resolve, reject) => {
                                tcp_socket.onopen = ((event) => {
                                    resolve(event.type);
                                });

                                tcp_socket.onerror = ((event) => {
                                    throw new ExtensionError(event.name);
                                });
                            });
                            if (eventType != "open" || tcp_socket.readyState != "open") {
                                throw new ExtensionError("TCP socket didn't properly open");
                            }

                            // After we know that the socket is open, send the bytes
                            tcp_socket.send(buf.buffer, buf.byteOffset, buf.byteLength);
                            let responseBytes = await new Promise((resolve, reject) => {
                                let data = new Uint8Array();
                                let expectedLength;

                                tcp_socket.ondata = ((event) => {
                                    if (data.length == 0) {
                                        expectedLength = new DataView(event.data).getUint16(0);
                                        let receivedData = new Uint8Array(event.data);
                                        data = receivedData;
                                    } else {
                                        data = concatUint8Arrays(data, receivedData);
                                    }

                                    // Check if we have got all the expected data, or if we've got too much data
                                    if (data.length == expectedLength + 2) {
                                        resolve(data);
                                    } else if (data.length > expectedLength + 2) {
                                        throw new ExtensionError("Got too many bytes from TCP");
                                    }
                                });

                                tcp_socket.onopen = ((event) => {
                                    throw new ExtensionError("Got an additional open event");
                                });

                                tcp_socket.onerror = ((event) => {
                                    throw new ExtensionError(event.name);
                                });
                            });
                            return responseBytes;
                        } catch(e) {
                            throw new ExtensionError(e.message);
                        } finally {
                            tcp_socket.close();
                        }
                    }
                },
            },
        };
    }
};
