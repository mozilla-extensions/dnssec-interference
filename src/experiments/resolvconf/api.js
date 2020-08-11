"use strict";
/* exported resolvconf */
/* global ChromeUtils, ExtensionAPI, Cc, Ci, */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");

const MAC_RESOLVCONF_PATH = "/etc/resolv.conf";
const WIN_REGISTRY_TCPIP_PATH = "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters";
const WIN_REGISTRY_NAMESERVER_KEY = "DhcpNameServer";

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
                        let resolvconf_string = await OS.File.read(MAC_RESOLVCONF_PATH, { "encoding": "utf-8" });
                        let lines = resolvconf_string.split("\n");
                        for (var i = 0; i < lines.length; i++) {
                            let line = lines[i];
                            if (line.startsWith("nameserver")) {
                                let ns = /^nameserver\s+([0-9.]+)(\s|$)/.exec(line)[1];
                                nameservers.push(ns);
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
                        let rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE;
                        let key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
                            Ci.nsIWindowsRegKey
                        );

                        try {
                            key.open(rootKey, WIN_REGISTRY_TCPIP_PATH, Ci.nsIWindowsRegKey.ACCESS_READ);
                            let nameservers_registry = key.readStringValue(WIN_REGISTRY_NAMESERVER_KEY);
                            nameservers_registry = nameservers_registry.trim();
                            nameservers_registry = nameservers_registry.match(/([0-9.]+)(\s|$)/g);
                        } finally {
                            key.close();
                        }
                        return nameservers;
                    }
                }
            }
        };
    }
};
