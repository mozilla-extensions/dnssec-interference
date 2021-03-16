"use strict";
/* exported resolvconf */
/* global ChromeUtils, ExtensionAPI, Cc, Ci, */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
const { ExtensionUtils } = ChromeUtils.import(
  "resource://gre/modules/ExtensionUtils.jsm"
);
const { ExtensionError } = ExtensionUtils;

const MAC_RESOLVCONF_PATH = "/etc/resolv.conf";
const STUDY_ERROR_NAMESERVERS_FILE = "STUDY_ERROR_NAMESERVERS_FILE";

var resolvconf = class resolvconf extends ExtensionAPI {
    getAPI(context) {
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
