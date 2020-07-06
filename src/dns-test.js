/* global browser */
const dnsPacket = require("dns-packet");

var query_proto;

const rollout = {
    sendQuery(domain, nameserver, record_type, useIPv4) {
        const buf = dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: record_type,
                name: domain
            }],
            additionals: [{
                type: 'OPT',
                name: '.',
                udpPayloadSize: 4096,
                flags: dnsPacket.DNSSEC_OK
            }]
        });
        query_proto = buf.__proto__;
        console.log('Query decoded');
        console.log(dnsPacket.decode(buf));

        browser.experiments.udpsocket.onDNSResponseReceived.addListener(
            this.processDNSResponse);
        browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, useIPv4);
    },

    processDNSResponse(responseBytes) {
        Object.setPrototypeOf(responseBytes, query_proto);
        console.log('Response decoded');
        console.log(dnsPacket.decode(responseBytes));
    }
}

async function init() {
    let nameservers = await browser.experiments.resolvconf.readResolvConf();
    if (!Array.isArray(nameservers) || nameservers.length == 0) {
        throw "Could not read /etc/resolv.conf, or nameservers not found in file";
    }
  
    let ns_ipv4;
    let ns_ipv6;
    for (var i = 0; i < nameservers.length; i++) {
        let ns = nameservers[i];
        if (isUndefined(ns_ipv4) && !isUndefined(ns) && ns.includes(".")) {
            ns_ipv4 = ns;
        } else if (isUndefined(ns_ipv6) && !isUndefined(ns) && ns.includes(":")) {
            ns_ipv6 = ns;
        }
        console.log(ns_ipv4 + " " + ns_ipv6);
    }

    console.log("IPv4 Nameserver chosen: " + ns_ipv4);
    console.log("IPv6 Nameserver chosen: " + ns_ipv6);
    browser.experiments.udpsocket.openSocket();

    if (ns_ipv4) {
        rollout.sendQuery('example.com', ns_ipv4, 'A', true);
        rollout.sendQuery('example.com', ns_ipv4, 'DNSKEY', true);
        rollout.sendQuery('example.com', ns_ipv4, 'RRSIG', true);
    }
    if (ns_ipv6) {
        rollout.sendQuery('google.com', ns_ipv6, 'A', false);
        rollout.sendQuery('google.com', ns_ipv6, 'DNSKEY', false);
        rollout.sendQuery('google.com', ns_ipv6, 'RRSIG', false);
    }
}

function isUndefined(x) {
   return (typeof(x) === 'undefined' || x === null);
}

init();
