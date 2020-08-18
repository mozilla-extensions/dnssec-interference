"use strict";
/* exported resolvconf */
/* global ChromeUtils, ExtensionAPI, Cc, Ci, Cu */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
const { ExtensionUtils } = ChromeUtils.import(
  "resource://gre/modules/ExtensionUtils.jsm"
);
const { ExtensionError } = ExtensionUtils;

const MAC_RESOLVCONF_PATH = "/etc/resolv.conf";
const WIN_REGISTRY_TCPIP_PATH = "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters";
const WIN_REGISTRY_NAMESERVER_KEY = "DhcpNameServer";

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
                        let nameservers_registry;
                        let rootKey;
                        let key;
                        let closeHandler = {
                          close() {
                            try {
                              key.close();
                            } catch (e) {
                              Cu.reportError(e);
                            }
                          },
                        };
                        context.callOnClose(closeHandler);

                        try {
                            rootKey = Ci.nsIWindowsRegKey.ROOT_KEY_LOCAL_MACHINE;
                            key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(
                                Ci.nsIWindowsRegKey
                            );
                            key.open(rootKey, WIN_REGISTRY_TCPIP_PATH, Ci.nsIWindowsRegKey.ACCESS_READ);
                            nameservers_registry = key.readStringValue(WIN_REGISTRY_NAMESERVER_KEY);
                            nameservers = nameservers_registry
                                          .trim()
                                          .match(/(?<=\s|^)[0-9.]+(?=\s|$)/g);
                        } catch {
                            throw new ExtensionError(STUDY_ERROR_NAMESERVERS_FILE_WIN);
                        } finally {
                            context.forgetOnClose(closeHandler);
                            closeHandler.close();
                        }
                        return nameservers;
                    }
                }
            }
        };
    }
};
