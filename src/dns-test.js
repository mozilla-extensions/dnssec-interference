/* global browser */
const dnsPacket = require("dns-packet-fork");

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
                udpPayloadSize: 4096
            }]
        });
        query_proto = buf.__proto__;
        console.log('Query decoded');
        console.log(dnsPacket.decode(buf));

        browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, useIPv4);
    },

    processDNSResponse(responseBytes, usedIPv4Socket) {
        /* 
         * TODO: Replace first argument with the bytes that we care about
         * TODO: Determine if the bucket should be "event" or "main", rather 
         * than "dnssec-experiment"
         */
        // sendResponsePing([123], usedIPv4Socket);
        console.log(responseBytes, usedIPv4Socket);

        Object.setPrototypeOf(responseBytes, query_proto);
        decodedResponse = dnsPacket.decode(responseBytes);
        console.log('Response decoded');
        console.log(dnsPacket.decode(responseBytes));

    }
}

function sendResponsePing(_responseBytes, _usedIPv4Socket) {
    // Test ping
    const bucket = "dnssec-experiment";
    const options = {addClientId: true, addEnvironment: false};
    const payload = {
      responseBytes: _responseBytes,
      usedIPv4Socket: _usedIPv4Socket,
      testing: true
    };
    browser.telemetry.submitPing(bucket, payload, options);
}

async function init() {
    let nameservers = await browser.experiments.resolvconf.readNameserversMac();
    // let nameservers = await browser.experiments.resolvconf.readNameserversWin();
    console.log(nameservers);

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
    browser.experiments.udpsocket.onDNSResponseReceived.addListener(rollout.processDNSResponse);

    if (!isUndefined(ns_ipv4)) {
        rollout.sendQuery('example.com', ns_ipv4, 'A', true);
        rollout.sendQuery('example.com', ns_ipv4, 'AAAA', true);
        rollout.sendQuery('example.com', ns_ipv4, 'RRSIG', true);
        rollout.sendQuery('example.com', ns_ipv4, 'DNSKEY', true);
        rollout.sendQuery('cloudflare-http1.com', ns_ipv4, 'HTTPS', true);
        // rollout.sendquery('????', ns_ipv4, 'SMIMEA', true);
        // rollout.sendQuery('????', ns_ipv4, 'NEW', true);
    }

    // if (!isUndefined(ns_ipv6)) {
        // rollout.sendQuery('example.com', ns_ipv6, 'A', false);
        // rollout.sendQuery('example.com', ns_ipv6, 'AAAA', false);
        // rollout.sendQuery('example.com', ns_ipv6, 'RRSIG', false);
        // rollout.sendQuery('example.com', ns_ipv6, 'DNSKEY', false);
        // rollout.sendQuery('cloudflare-http1.com', ns_ipv6, 'HTTPS', false);
        // rollout.sendquery('????', ns_ipv6, 'SMIMEA', false);
        // rollout.sendQuery('????', ns_ipv6, 'NEW', false);
    // }
}

function isUndefined(x) {
   return (typeof(x) === 'undefined' || x === null);
}

init();
