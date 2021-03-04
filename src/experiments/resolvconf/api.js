"use strict";
/* exported resolvconf */
/* global ChromeUtils, ExtensionAPI, Cc, Ci, */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
const { ExtensionUtils } = ChromeUtils.import(
  "resource://gre/modules/ExtensionUtils.jsm"
);
const { ExtensionError } = ExtensionUtils;

const MAC_RESOLVCONF_PATH = "/etc/resolv.conf";
const WIN_REGISTRY_TCPIP_PATH = "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters";
const WIN_REGISTRY_TCPIP_IF_PATH = "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces";
const WIN_REGISTRY_DHCP_NAMESERVER_KEY = "DhcpNameServer";
const WIN_REGISTRY_NAMESERVER_KEY = "NameServer";

const STUDY_ERROR_NAMESERVERS_FILE_MAC = "STUDY_ERROR_NAMESERVERS_FILE_MAC";
const STUDY_ERROR_NAMESERVERS_FILE_WIN = "STUDY_ERROR_NAMESERVERS_FILE_WIN";

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
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE_MAC);
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
                        let rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE;
                        let key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
                            Ci.nsIWindowsRegKey
                        );
                        let key_if = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
                            Ci.nsIWindowsRegKey
                        );

                        try {
                            // Parse top-level registry for the Nameserver and 
                            // the DhcpNameserver keys. If we find something,
                            // return immediately.
                            key.open(rootKey, WIN_REGISTRY_TCPIP_PATH, Ci.nsIWindowsRegKey.ACCESS_READ);
                            let parentRegistryNameservers = await this.parseRegistry(key);
                            if (parentRegistryNameservers.length) {
                                console.log("Nameservers found on Windows: " + nameservers);
                                return parentRegistryNameservers;
                            }

                            // If we don't find anything in the top-level 
                            // registry, parse per-interface registries.
                            key_if.open(rootKey, WIN_REGISTRY_TCPIP_IF_PATH, Ci.nsIWindowsRegKey.ACCESS_READ);
                            let childCount = key_if.childCount;
                            for (let i = 0; i < childCount; i++) {
                                let childName = key_if.getChildName(i);
                                let childKey = key_if.openChild(childName, Ci.nsIWindowsRegKey.ACCESS_READ);
                                let childRegistryNameservers = await this.parseRegistry(childKey);
                                if (childRegistryNameservers.length) {
                                    console.log("Nameservers found on Windows: " + nameservers);
                                    return childRegistryNameservers;
                                }
                            }
                        } catch(e) {
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE_WIN);
                        } finally {
                            key.close();
                            key_if.close();
                        }
                        return [];
                    },

                    async parseRegistry(key) {
                        // First parse the Nameserver key, since it corresponds 
                        // to what users manually set (if anything). If we 
                        // found some nameservers, return immediately.
                        if (key.hasValue(WIN_REGISTRY_NAMESERVER_KEY)) {
                            let registry_nameserver_str = key.readStringValue(WIN_REGISTRY_NAMESERVER_KEY);
                            let registry_nameserver     = registry_nameserver_str
                                                          .trim()
                                                          .match(/(?<=\s|^)[0-9.]+(?=\s|$)/g);
                            registry_nameserver = registry_nameserver.filter((x, i, a) => a.indexOf(x) == i);
                            if (registry_nameserver && registry_nameserver.length) {
                                return registry_nameserver;
                            }
                        }

                        // If we didn't find any user-set nameservers in the 
                        // Nameservers key, read the nameservers set by DHCP 
                        // in the DhcpNameserver key.
                        if (key.hasValue(WIN_REGISTRY_DHCP_NAMESERVER_KEY)) {
                            let registry_dhcp_nameserver_str = key.readStringValue(WIN_REGISTRY_DHCP_NAMESERVER_KEY);
                            let registry_dhcp_nameserver     = registry_dhcp_nameserver_str
                                                               .trim()
                                                               .match(/(?<=\s|^)[0-9.]+(?=\s|$)/g);
                            registry_dhcp_nameserver = registry_dhcp_nameserver.filter((x, i, a) => a.indexOf(x) == i);
                            if (registry_dhcp_nameserver && registry_dhcp_nameserver.length) {
                                return registry_dhcp_nameserver;
                            }
                        }
                        return [];
                    }
                }
            }
        };
    }
};
