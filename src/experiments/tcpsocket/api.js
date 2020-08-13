"use strict";
/* exported tcpsocket */
/* global ExtensionError, ExtensionAPI, ChromeUtils, Cu */

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
                        let closeHandler = {
                          close() {
                            try {
                              tcp_socket.close();
                            } catch (e) {
                              Cu.reportError(e);
                            }
                          },
                        };
                        context.callOnClose(closeHandler);

                        try {
                            /**
                             * Wait until the socket is open before sending data.
                             * If we get an 'error' event before an 'open' event, 
                             * throw an ExtensionError.
                             */
                            tcp_socket = new TCPSocket(addr, 53, { binaryType: "arraybuffer" });
                            let responseBytes = await new Promise((resolve, reject) => {
                                let data = new Uint8Array();
                                let expectedLength;

                                tcp_socket.ondata = ((event) => {
                                    data = concatUint8Arrays(data, new Uint8Array(event.data));
                                    if (data.length >= 2 && !expectedLength) {
                                        expectedLength = new DataView(data.buffer).getUint16(0) + 2;
                                    }

                                    // Check if we have got all the expected data, or if we've got too much data
                                    if (data.length == expectedLength) {
                                        resolve(data);
                                    } else if (data.length > expectedLength) {
                                        reject(new ExtensionError("Got too many bytes from TCP"));
                                    }
                                });

                                tcp_socket.onopen = ((event) => {
                                    // After we know that the socket is open, send the bytes
                                    tcp_socket.onopen = null;
                                    tcp_socket.send(buf.buffer, buf.byteOffset, buf.byteLength);
                                });

                                tcp_socket.onerror = ((event) => {
                                    reject(new ExtensionError(event.name));
                                });

                                tcp_socket.onclose = ((event) => {
                                    if (data.length < expectedLength) {
                                        reject(new ExtensionErorr("Got too few bytes from TCP"));
                                    }
                                });
                            });
                            return responseBytes;
                        } finally {
                            context.forgetOnClose(closeHandler);
                            closeHandler.close();
                        }
                    }
                },
            },
        };
    }
};
