"use strict";
/* exported resolvconf */
/* global ChromeUtils, ExtensionAPI, Cc, Ci, */

/** Warning!!
 *  You shouldn't declare anything in the global scope, which is shared with other api.js from the same privileged extension.
 *  See https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/basics.html#globals-available-in-the-api-scripts-global
 */

var resolvconf = class resolvconf extends ExtensionAPI {
    static MAC_RESOLVCONF_PATH = "/etc/resolv.conf";
    static STUDY_ERROR_NAMESERVERS_FILE = "STUDY_ERROR_NAMESERVERS_FILE";

    constructor(...args) {
        super(...args);
        ChromeUtils.defineModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
    }

    getAPI(context) {
        const {
            MAC_RESOLVCONF_PATH,
            STUDY_ERROR_NAMESERVERS_FILE
        } = resolvconf;

        const { ExtensionError } = ExtensionUtils;
        const { OS } = this;

        return {
            experiments: {
                resolvconf: {
                    /**
                     * If a client is on macOS, read nameservers from
                     * /etc/resolv.conf
                     */
                    async readNameserversMac() {
                        let nameservers = [];
                        let resolvconf_string;
                        try {
                            resolvconf_string = await OS.File.read(MAC_RESOLVCONF_PATH, { "encoding": "utf-8" });
                        } catch(e) {
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE);
                        }

                        let lines = resolvconf_string.split("\n");
                        for (let line of lines) {
                            let match = /^nameserver\s+([0-9.]+)(\s|$)/.exec(line);
                            if (match) {
                                nameservers.push(match[1]);
                            }
                        }
                        return nameservers;
                    },

                    /**
                     * If a client is on Windows, read nameservers from 
                     * a registry
                     */
                    async readNameserversWin() {
                        let nameservers = [];
                        try {
                            let nameserversResult = Cc["@mozilla.org/network/network-link-service;1"].getService(Ci.nsINetworkLinkService).resolvers; 
                            for (let nameserver of nameserversResult) {
                                if (nameserver.family === 1 && nameserver.address) {
                                    nameservers.push(nameserver.address);
                                }
                            }
                        } catch(e) {
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE);
                        }
                        return nameservers;
                    }
                }
            }
        };
    }
};
