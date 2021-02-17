"use strict";
/* exported netstatus */
/* global Cc, Ci */

var netstatus = class netstatus extends ExtensionAPI {
    getAPI(context) {
        return {
            experiments: {
                netstatus: {
                    /**
                     * Use Firefox APIs to check whether the client is 
                     * connected to the Internet or not
                     */
                    async checkOnlineStatus() {
                        let ncs = Cc[
                            "@mozilla.org/network/network-connectivity-service;1"
                        ].getService(Ci.nsINetworkConnectivityService);

                        ncs.recheckDNS();
                        ncs.recheckIPConnectivity();
                        console.log(ncs)
                        if (ncs.DNSv4 != Ci.nsINetworkConnectivityService.OK) {
                            return false
                        }
                        if (ncs.IPv4 != Ci.nsINetworkConnectivityService.OK) {
                            return false
                        }
                        return true
                    },
                },
            },
        };
    }
};
