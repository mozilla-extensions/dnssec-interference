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
                        let nameservers = [];
                        let rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE;
                        let key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
                            Ci.nsIWindowsRegKey
                        );

                        try {
                            key.open(rootKey, WIN_REGISTRY_TCPIP_PATH, Ci.nsIWindowsRegKey.ACCESS_READ);
                            let registry_dhcp_nameserver = key.readStringValue(WIN_REGISTRY_DHCP_NAMESERVER_KEY);
                            let registry_nameserver = key.readStringValue(WIN_REGISTRY_NAMESERVER_KEY);
                            registry_dhcp_nameserver = registry_dhcp_nameserver
                                                       .trim()
                                                       .match(/(?<=\s|^)[0-9.]+(?=\s|$)/g);
                            registry_nameserver      = registry_nameserver
                                                       .trim()
                                                       .match(/(?<=\s|^)[0-9.]+(?=\s|$)/g);

                            if (registry_dhcp_nameserver && registry_dhcp_nameserver.length) {
                                nameservers = nameservers.concat(registry_dhcp_nameserver);
                            }
                            if (registry_nameserver && registry_nameserver.length) {
                                nameservers = nameservers.concat(registry_nameserver);
                            }
                        } catch {
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE_WIN);
                        } finally {
                            key.close();
                        }

                        console.log(nameservers);
                        nameservers = nameservers.filter((x, i, a) => a.indexOf(x) == i);
                        return nameservers;
                    }
                }
            }
        };
    }
};
