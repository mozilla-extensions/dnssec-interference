"use strict";
/* exported tcpsocket */
/* global ExtensionError, ExtensionAPI, ChromeUtils, Cu */

const { TCPSocket } = Cu.getGlobalForObject(
    ChromeUtils.import("resource://gre/modules/Services.jsm")
);

/**
 * Long timeout just in case we don't receive enough data 
 * but the socket doesn't close
 */
const LONG_TIMEOUT = 60000;

const STUDY_ERROR_TCP_NETWORK_TIMEOUT = "STUDY_ERROR_TCP_NETWORK_TIMEOUT";
const STUDY_ERROR_TCP_NETWORK_MISC = "STUDY_ERROR_TCP_NETWORK_MISC";
const STUDY_ERROR_TCP_CONNECTION_REFUSED = "STUDY_ERROR_TCP_CONNECTION_REFUSED";
const STUDY_ERROR_TCP_NOT_ENOUGH_BYTES = "STUDY_ERROR_TCP_NOT_ENOUGH_BYTES"; 
const STUDY_ERROR_TCP_TOO_MANY_BYTES = "STUDY_ERROR_TCP_TOO_MANY_BYTES";
const STUDY_ERROR_TCP_QUERY_TIMEOUT = "STUDY_ERROR_TCP_QUERY_TIMEOUT";

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
                                        reject(new ExtensionError(STUDY_ERROR_TCP_TOO_MANY_BYTES));
                                    }
                                });

                                tcp_socket.onopen = ((event) => {
                                    // After we know that the socket is open, send the bytes
                                    tcp_socket.onopen = null;
                                    tcp_socket.send(buf.buffer, buf.byteOffset, buf.byteLength);
                                });

                                tcp_socket.onerror = ((event) => {
                                    if (event.name == "ConnectionRefusedError") {
                                        reject(new ExtensionError(STUDY_ERROR_TCP_CONNECTION_REFUSED));
                                    } else if (event.name == "NetworkTimeoutError") {
                                        reject(new ExtensionError(STUDY_ERROR_TCP_NETWORK_TIMEOUT));
                                    } else {
                                        reject(new ExtensionError(STUDY_ERROR_TCP_NETWORK_MISC)); 
                                    }
                                });

                                tcp_socket.onclose = ((event) => {
                                    if (data.length < expectedLength) {
                                        reject(new ExtensionError(STUDY_ERROR_TCP_NOT_ENOUGH_BYTES));
                                    }
                                });

                                setTimeout(() => {
                                    reject(new ExtensionError(STUDY_ERROR_TCP_QUERY_TIMEOUT));
                                }, LONG_TIMEOUT);
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
