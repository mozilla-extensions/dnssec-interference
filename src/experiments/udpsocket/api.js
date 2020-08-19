"use strict";
/* exported udpsocket */
/* global Cu, Components, ChromeUtils, ExtensionError, ExtensionAPI */

const Cc = Components.classes;
const Ci = Components.interfaces;
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { setTimeout } = ChromeUtils.import("resource://gre/modules/Timer.jsm");

const RESOLVCONF_TIMEOUT = 5000; // Default timeout set by resolvconf for queries

const STUDY_ERROR_UDP_PREMATURE_CLOSE = "STUDY_ERROR_UDP_PREMATURE_CLOSE";
const STUDY_ERROR_UDP_BYTES_WRITTEN = "STUDY_ERROR_UDP_BYTES_WRITTEN";
const STUDY_ERROR_UDP_QUERY_TIMEOUT = "STUDY_ERROR_UDP_QUERY_TIMEOUT";

var udpsocket = class udpsocket extends ExtensionAPI {
    getAPI(context) {
        return {
            experiments: {
                udpsocket: {
                    /**
                     * Send a DNS query stored in buf to a nameserver addresses by addr 
                     * over a UDP socket
                     */
                    async sendDNSQuery(addr, buf) {
                        let written = 0;
                        let responseBytes = new Uint8Array();
                        let socket = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
                        let closeHandler = {
                            close() {
                                try {
                                    socket.close();
                                } catch (e) {
                                    Cu.reportError(e);
                                }
                            },
                        };
                        context.callOnClose(closeHandler);

                        try {
                            // Initialize the UDP socket
                            socket.init2("0.0.0.0", -1, Services.scriptSecurityManager.getSystemPrincipal(), true);

                            // Set up a Promise that resolves when we get a response on the UDP socket
                            responseBytes = await new Promise((resolve, reject) => {
                                socket.asyncListen({
                                    QueryInterface: ChromeUtils.generateQI([Ci.nsIUDPSocketListener]),
                                    onPacketReceived(aSocket, aMessage) {
                                        resolve(aMessage.rawData);
                                    },
                                    onStopListening(aSocket, aStatus) { 
                                        reject(new ExtensionError(STUDY_ERROR_UDP_PREMATURE_CLOSE));
                                    }
                                }); 

                                written = socket.send(addr, 53, buf);
                                if (written != buf.length) {
                                    reject(new ExtensionError(STUDY_ERROR_UDP_BYTES_WRITTEN));
                                }

                                setTimeout(() => {
                                    reject(new ExtensionError(STUDY_ERROR_UDP_QUERY_TIMEOUT));
                                }, RESOLVCONF_TIMEOUT);
                            });
                            return responseBytes;
                        } finally {
                            context.forgetOnClose(closeHandler);
                            closeHandler.close();
                        }
                    },
                },
            },
        };
    }
};
