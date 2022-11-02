"use strict";
/* exported udpsocket */
/* global Cu, CC, Ci, ChromeUtils, ExtensionUtils, ExtensionAPI, Services */

/** Warning!!
 *  You shouldn't declare anything in the global scope, which is shared with other api.js from the same privileged extension.
 *  See https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/basics.html#globals-available-in-the-api-scripts-global
 */

var udpsocket = class udpsocket extends ExtensionAPI {
    static RESOLVCONF_TIMEOUT = 5000; // Default timeout set by resolvconf for queries
    static STUDY_ERROR_UDP_PREMATURE_CLOSE = "STUDY_ERROR_UDP_PREMATURE_CLOSE";
    static STUDY_ERROR_UDP_BYTES_WRITTEN = "STUDY_ERROR_UDP_BYTES_WRITTEN";
    static STUDY_ERROR_UDP_QUERY_TIMEOUT = "STUDY_ERROR_UDP_QUERY_TIMEOUT";

    constructor(...args) {
        super(...args);
        ChromeUtils.defineModuleGetter(this, "setTimeout", "resource://gre/modules/Timer.jsm");
    }

    getAPI(context) {
        const {
            RESOLVCONF_TIMEOUT,
            STUDY_ERROR_UDP_PREMATURE_CLOSE,
            STUDY_ERROR_UDP_BYTES_WRITTEN,
            STUDY_ERROR_UDP_QUERY_TIMEOUT
        } = udpsocket;
        const { ExtensionError } = ExtensionUtils;
        const { setTimeout } = this;
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
