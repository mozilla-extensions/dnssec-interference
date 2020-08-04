/* global browser */
const DNS_PACKET = require("dns-packet-dev");
const { v4: uuidv4 } = require("uuid");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2a._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "_443._tcp.dnssec-experiment-moz.net";

const RRTYPES = ['A', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEWONE', 'NEWTWO'];
const RESOLVCONF_TIMEOUT = 5000; // 5 seconds
const RESOLVCONF_ATTEMPTS = 2;

const TELEMETRY_PIPELINE = "shield";

var nameservers = [];
var query_proto;
var measurement_id;

var dnsResponses = {"A":      {"data": "", "transmission": 0},
                    "RRSIG":  {"data": "", "transmission": 0},
                    "DNSKEY": {"data": "", "transmission": 0},
                    "SMIMEA": {"data": "", "transmission": 0},
                    "HTTPS":  {"data": "", "transmission": 0},
                    "NEWONE": {"data": "", "transmission": 0},
                    "NEWTWO": {"data": "", "transmission": 0}};

const rollout = {
    async sendQuery(domain, nameservers, rrtype) {
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
                dnsResponses[rrtype]["transmission"] += 1
                let written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype);
                if (written <= 0) {
                    // sendTelemetry({"event": "noBytesWritenError", 
                    //                "rrtype": rrtype, 
                    //                "transmission": j.toString()});
                }
                await sleep(RESOLVCONF_TIMEOUT);

                if (isUndefined(dnsResponses[rrtype]["data"]) || dnsResponses[rrtype]["data"] === "") {
                    console.log("Need to re-transmit");
                } else {
                    return
                }
            }
        }
    },

    processDNSResponse(responseBytes, rrtype) {
        dnsResponses[rrtype]["data"] = responseBytes;
        console.log(responseBytes, rrtype);

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
    let nameservers = [];
    try { 
        let platform = await browser.runtime.getPlatformInfo();
        if (platform.os == "mac") {
            nameservers = await browser.experiments.resolvconf.readNameserversMac();
        } else if (platform.os == "win") {
            nameservers = await browser.experiments.resolvconf.readNameserversWin();
        }
    } catch(e) {
        // sendTelemetry({"event": "readNameserversError"});
        throw e;
    } 

    if (!Array.isArray(nameservers) || nameservers.length <= 0) {
        // sendTelemetry({"event": "noNameserversError"});
        throw "No nameservers found";
    }

    let nameservers_ipv4 = [];
    for (var i = 0; i < nameservers.length; i++) {
        let ns = nameservers[i];
        if (!isUndefined(ns) && ns.includes(".")) {
            nameservers_ipv4.push(ns);
        }
    }

    if (nameservers_ipv4.length <= 0) {
        // sendTelemetry({"event": noIPv4NameserversError"});
        throw "No IPv4 nameservers found";
    }
    console.log("IPv4 resolvers: ", nameservers_ipv4);
    return nameservers_ipv4;
}

async function setupUPDSockets() {
    try {
        await browser.experiments.udpsocket.openSocket();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(rollout.processDNSResponse);
    } catch(e) {
        // sendTelemetry({"event": "openUDPSocketsError"});
        throw e;
    }
}

async function sendQueries(nameservers_ipv4) {
    for (let i = 0; i < RRTYPES.length; i++) {
      try {
        let rrtype = RRTYPES[i];
        if (rrtype == 'SMIMEA') {
            await rollout.sendQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype, true);
        } else if (rrtype == 'HTTPS') {
            await rollout.sendQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype, true);
        } else {
            await rollout.sendQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, true);
        }
      } catch(e) {
        // sendTelemetry({"event": "sendQueryError"});
        throw e;
      }
    }

    // TODO: Send DNS responses to telemetry
    let payload = {"event": "dnsResponses"};
    for (const rrtype in dnsResponses) {
       payload[rrtype + "_data"] = dnsResponses[rrtype]["data"].toString();
       payload[rrtype + "_transmission"] = dnsResponses[rrtype]["transmission"].toString();
    }
    console.log(payload);
    // sendTelemetry(payload);
}

function sendTelemetry(payload) {
    payload["measurement_id"] = measurement_id;
    browser.study.sendTelemetry(payload, TELEMETRY_PIPELINE);
}

function cleanup() {
    browser.experiments.udpsocket.onDNSResponseReceived.removeListener(rollout.processDNSResponse);
}

async function runMeasurement() {
    // Send a ping to indicate the start of the measurement
    measurement_id = uuidv4();
    // sendTelemetry({"event": "startMeasurement"});

    let nameservers_ipv4 = await readNameservers();
    // await setupUDPSockets();
    // await sendQueries(nameservers_ipv4);

    // Send a ping to indicate the start of the measurement
    // sendTelemetry({"event": "endMeasurement"});
    // cleanup();
}

runMeasurement();
