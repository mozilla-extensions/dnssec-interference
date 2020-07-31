/* global browser */
const DNS_PACKET = require("dns-packet-fork");

const DOMAIN_NAME = "dnssec-experiment-moz.net"
const RRTYPES = ['A', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEW'];
const RESOLVCONF_TIMEOUT = 5000; // 5 seconds
const RESOLVCONF_ATTEMPTS = 2;

const TELEMETRY_CATEGORY = "dnssecExperiment";
const TELEMETRY_METHOD = "measurement";

var nameservers = [];
var query_proto;

var dnsResponses = {"A":      {"data": "", "transmission": ""},
                    "RRSIG":  {"data": "", "transmission": ""},
                    "DNSKEY": {"data": "", "transmission": ""},
                    "SMIMEA": {"data": "", "transmission": ""},
                    "HTTPS":  {"data": "", "transmission": ""},
                    "NEW":    {"data": "", "transmission": ""}};

const rollout = {
    async sendQuery(domain, nameservers, rrtype, useIPv4) {
        let written = 0;
        const buf = DNS_PACKET.encode({
            type: 'query',
            id: 1,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{
                type: rrtype,
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
        console.log(DNS_PACKET.decode(buf));

        // Keep re-transmitting according to default resolv.conf behavior,
        // checking if we have a DNS response for the RR type yet
        for (let i = 0; i < nameservers.length; i++) {
            for (let j = 1; j <= RESOLVCONF_ATTEMPTS; j++) {
                let nameserver = nameservers[i];
                dnsResponses[rrtype]["transmission"] = j;
                let written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype, useIPv4);
                if (written <= 0) {
                    browser.study.sendTelemetry({
                      "event": "sendDNSQueryError",
                      "rrtype": rrtype,
                      "transmission": j.toString(),
                      "usedIPv4": "true"},
                    "shield");
                }
                await sleep(RESOLVCONF_TIMEOUT);

                if (isUndefined(dnsResponses[rrtype]["data"])) {
                    console.log("Need to re-transmit");
                } else {
                    return
                }
            }
        }
    },

    processDNSResponse(responseBytes, rrtype, usedIPv4) {
        /* 
         * TODO: Replace first argument with the bytes that we care about
         * TODO: Determine if the bucket should be "event" or "main", rather 
         * than "dnssec-experiment"
         */
        dnsResponses[rrtype]["data"] = responseBytes;
        console.log(responseBytes, rrtype, (usedIPv4 = true ? "IPv4" : "IPv4"));

        Object.setPrototypeOf(responseBytes, query_proto);
        decodedResponse = DNS_PACKET.decode(responseBytes);
        console.log('Response decoded');
        console.log(decodedResponse);
    }
}

function isUndefined(x) {
    return (typeof(x) === 'undefined' || x === null);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readNameservers() {
    try{ 
        nameservers = await browser.experiments.resolvconf.readNameserversMac();
        // nameservers = await browser.experiments.resolvconf.readNameserversWin();
    } catch(e) {
        browser.study.sendTelemetry({"event": "readNameserversError"}, "shield");
        throw e;
    } 

    if (!Array.isArray(nameservers) || nameservers.length <= 0) {
        browser.study.sendTelemetry({"event": "noNameserversError"}, "shield");
        throw e;
    }

    let nameservers_ipv4 = [];
    let nameservers_ipv6 = [];
    for (var i = 0; i < nameservers.length; i++) {
        let ns = nameservers[i];
        if (!isUndefined(ns) && ns.includes(".")) {
            nameservers_ipv4.push(ns);
        } else if (!isUndefined(ns) && ns.includes(":")) {
            nameservers_ipv6.push(ns);
        }
    }
    console.log("IPv4 resolvers: ", nameservers_ipv4);
    console.log("IPv6 resolvers: ", nameservers_ipv6);
    return [nameservers_ipv4, nameservers_ipv6];
}

async function setupNetworkingCode() {
    // TODO: If we use IPv4 and IPv6 sockets in the future, then we may 
    // want to split openSocket() into two different methods. This would enable 
    // us to determine if IPV4 sockets vs. IPv6 sockets failed to open.
    try {
        await browser.experiments.udpsocket.openSocket();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(rollout.processDNSResponse);
    } catch(e) {
        // Since we're just using IPv4 sockets right now, 
        // hard-code "usedIPv4" to "true."
        browser.study.sendTelemetry({
            "event": "openSocketError",
            "usedIPv4": "true"},
        "shield");
        throw e;
    }
}

async function sendQueries(nameservers_ipv4, nameservers_ipv6) {
    for (let i = 0; i < RRTYPES.length; i++) {
      try {
        let rrtype = RRTYPES[i];
        await rollout.sendQuery(DOMAIN_NAME, nameservers_ipv4, rrtype, true);
      } catch(e) {
        browser.study.sendTelemetry({"event": "sendQueryError", 
                                     "usedIPv4": "true"},
                                     "shield");
        throw e;
      }
    }
    // TODO: Send DNS responses to telemetry
}

async function runMeasurement() {
    // Send a ping to indicate the start of the measurement
    browser.study.sendTelemetry({"event": "startMeasurement"}, "shield");

    let nameservers = await readNameservers();
    let nameservers_ipv4 = nameservers[0];
    let nameservers_ipv6 = nameservers[1];
    console.log(nameservers_ipv4, nameservers_ipv6);

    await setupNetworkingCode();
    await sendQueries(nameservers_ipv4, nameservers_ipv6);

    // Send a ping to indicate the start of the measurement
    browser.study.sendTelemetry({"event": "endMeasurement"}, "shield");
}

runMeasurement();
