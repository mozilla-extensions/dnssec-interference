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
var udp_query_proto;
var tcp_query_proto;
var measurement_id;

var udpResponses = {"A":      {"data": "", "transmission": 0},
                    "RRSIG":  {"data": "", "transmission": 0},
                    "DNSKEY": {"data": "", "transmission": 0},
                    "SMIMEA": {"data": "", "transmission": 0},
                    "HTTPS":  {"data": "", "transmission": 0},
                    "NEWONE": {"data": "", "transmission": 0},
                    "NEWTWO": {"data": "", "transmission": 0}};

var tcpResponses = {"A":      {"data": "", "transmission": 0},
                    "RRSIG":  {"data": "", "transmission": 0},
                    "DNSKEY": {"data": "", "transmission": 0},
                    "SMIMEA": {"data": "", "transmission": 0},
                    "HTTPS":  {"data": "", "transmission": 0},
                    "NEWONE": {"data": "", "transmission": 0},
                    "NEWTWO": {"data": "", "transmission": 0}};

const rollout = {
    encodeUDPQuery(domain, rrtype) {
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
        udp_query_proto = buf.__proto__;
        return buf
    },

    encodeTCPQuery(domain, rrtype) {
        const buf = DNS_PACKET.streamEncode({
            type: 'query',
            id: 1500,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{
                type: rrtype,
                name: domain
            }]
        });
        tcp_query_proto = buf.__proto__;
        return buf;
    },

    async sendUDPQuery(domain, nameservers, rrtype) {
        // Keep re-transmitting according to default resolv.conf behavior,
        // checking if we have a DNS response for the RR type yet
        let buf = rollout.encodeUDPQuery(domain, rrtype);
        let written = 0;
        for (let i = 0; i < nameservers.length; i++) {
            for (let j = 1; j <= RESOLVCONF_ATTEMPTS; j++) {
                let nameserver = nameservers[i];
                udpResponses[rrtype]["transmission"] += 1
                let written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype);
                if (written <= 0) {
                    // sendTelemetry({"event": "noBytesWritenError", 
                    //                "rrtype": rrtype, 
                    //                "transmission": j.toString()});
                }
                await sleep(RESOLVCONF_TIMEOUT);

                if (isUndefined(udpResponses[rrtype]["data"]) || udpResponses[rrtype]["data"] === "") {
                    console.log("Need to re-transmit UDP query");
                } else {
                    return
                }
            }
        }
    },

    async sendTCPQuery(domain, nameservers, rrtype) {
        let buf = rollout.encodeTCPQuery(domain, rrtype);
        for (let i = 0; i < nameservers.length; i++) {
            let nameserver = nameservers[i];
            tcpResponses[rrtype]["transmission"] += 1;
            tcpResponses[rrtype]["data"] = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, buf);

            if (isUndefined(tcpResponses[rrtype]["data"]) || tcpResponses[rrtype]["data"] === "") {
                console.log("Need to re-transmit TCP query");
            } else {
                Object.setPrototypeOf(tcpResponses[rrtype]["data"], tcp_query_proto);
                decodedResponse = DNS_PACKET.streamDecode(tcpResponses[rrtype]["data"]);
                console.log('TCP Response decoded');
                console.log(decodedResponse);
                return
            }
        }
        // TODO: Maybe send telemetry if we don't get any response, of if an error came back from tcpsocket.sendDNSQuery()
    },

    processUDPResponse(responseBytes, rrtype) {
        udpResponses[rrtype]["data"] = responseBytes;
        console.log(responseBytes, rrtype);

        Object.setPrototypeOf(responseBytes, udp_query_proto);
        decodedResponse = DNS_PACKET.decode(responseBytes);
        console.log('UDP Response decoded');
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

async function setupUDPCode() {
    try {
        await browser.experiments.udpsocket.openSocket();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(rollout.processUDPResponse);
    } catch(e) {
        // sendTelemetry({"event": "openUDPSocketsError"});
        throw e;
    }
}

async function sendQueries(nameservers_ipv4, useUDP) {
    for (let i = 0; i < RRTYPES.length; i++) {
      try {
        let rrtype = RRTYPES[i];
        if (rrtype == 'SMIMEA') {
            await rollout.sendUDPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await rollout.sendTCPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype);
        } else if (rrtype == 'HTTPS') {
            await rollout.sendUDPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await rollout.sendTCPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype);
        } else {
            await rollout.sendUDPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await rollout.sendTCPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype);
        }
      } catch(e) {
        // Might want to let the program keep going by removing the throw statement. 
        // Also might want to add to the ping the RR type and socket type that failed
        // sendTelemetry({"event": "sendQueryError"});
        throw e;
      }
    }

    // TODO: Send DNS responses to telemetry
    let payload = {"event": "dnsResponses"};
    for (let i = 0; i < RRTYPES.length; i++) {
        let rrtype = RRTYPES[i];
        payload[rrtype + "_udp_data"] = udpResponses[rrtype]["data"];
        payload[rrtype + "_udp_transmission"] = udpResponses[rrtype]["transmission"].toString();
        payload[rrtype + "_tcp_data"] = tcpResponses[rrtype]["data"];
        payload[rrtype + "_tcp_transmission"] = tcpResponses[rrtype]["transmission"].toString();
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
    await setupUDPCode();
    await sendQueries(nameservers_ipv4);

    // Send a ping to indicate the start of the measurement
    // sendTelemetry({"event": "endMeasurement"});
    // cleanup();
}

runMeasurement();
