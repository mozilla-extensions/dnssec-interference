/* global browser */
const DNS_PACKET = require("dns-packet-dev");
const { v4: uuidv4 } = require("uuid");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2a._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "_443._tcp.dnssec-experiment-moz.net";

const RRTYPES = ['A', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEWONE', 'NEWTWO'];
const RESOLVCONF_TIMEOUT = 5000; // 5 seconds
const RESOLVCONF_ATTEMPTS = 2;

const TELEMETRY_TYPE = "dnssec-interference-report";
const TELEMETRY_OPTIONS = {
    addClientId: true,
    addEnvironment: true
};

const MAX_TXID = 65535;
const MIN_TXID = 0;

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

function encodeUDPQuery(domain, rrtype) {
    const buf = DNS_PACKET.encode({
        type: 'query',
        // Generate a random transaction ID between 0 and 65535
        id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
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
}

function encodeTCPQuery(domain, rrtype) {
    const buf = DNS_PACKET.streamEncode({
        type: 'query',
        // Generate a random transaction ID between 0 and 65535
        id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
        flags: DNS_PACKET.RECURSION_DESIRED,
        questions: [{
            type: rrtype,
            name: domain
        }]
    });
    tcp_query_proto = buf.__proto__;
    return buf;
}

async function sendUDPQuery(domain, nameservers, rrtype) {
    // Keep re-transmitting according to default resolv.conf behavior,
    // checking if we have a DNS response for the RR type yet
    try{ 
        let buf = encodeUDPQuery(domain, rrtype);
        let written = 0;
        for (let i = 0; i < nameservers.length; i++) {
            for (let j = 1; j <= RESOLVCONF_ATTEMPTS; j++) {
                let nameserver = nameservers[i];
                let written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype);
                udpResponses[rrtype]["transmission"] += 1
                if (written <= 0) {
                    // sendTelemetry({"event": "noBytesWritenError", 
                    //                "rrtype": rrtype, 
                    //                "usedUDP": "true",
                    //                "transmission": udpResponses[rrtype]["transmission"]});
                }
                await sleep(RESOLVCONF_TIMEOUT);

                if (isUndefined(udpResponses[rrtype]["data"]) || udpResponses[rrtype]["data"] === "") {
                    console.log("Need to re-transmit UDP query");
                } else {
                    return
                }
            }
        }
    } catch(e) {
        // sendTelemetry({"event": "sendQueryError",
        //                "rrtype": rrtype,
        //                "usedUDP": "true"});
    }
}

async function sendTCPQuery(domain, nameservers, rrtype) {
    try {
        let buf = encodeTCPQuery(domain, rrtype);
        for (let i = 0; i < nameservers.length; i++) {
            let nameserver = nameservers[i];
            let responseBytes = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, buf);
            tcpResponses[rrtype]["transmission"] += 1;
            let responseString = String.fromCharCode(...responseBytes);

            if (responseString == "") {
                console.log("Need to re-transmit TCP query");
            } else {
                tcpResponses[rrtype]["data"] = responseString;

                // Decode for debugging purposes
                Object.setPrototypeOf(responseBytes, tcp_query_proto);
                decodedResponse = DNS_PACKET.streamDecode(responseBytes);
                console.log(rrtype + ": TCP Response decoded");
                console.log(decodedResponse);
                console.log()
                return
            }
        }
    } catch(e) {
        // sendTelemetry({"event": "sendQueryError",
        //                "rrtype": rrtype,
        //                "usedUDP": "false"});
    }
}

function processUDPResponse(responseBytes, rrtype) {
    let responseString = String.fromCharCode(...responseBytes);
    udpResponses[rrtype]["data"] = responseString;

    Object.setPrototypeOf(responseBytes, udp_query_proto);
    decodedResponse = DNS_PACKET.decode(responseBytes);
    console.log(rrtype + ": UDP Response decoded");
    console.log(decodedResponse);

    // For debugging purposes:
    // Convert the encoded string back to a byte array for debugging purposes
    // let responseStringToBytes = Uint8Array.from([...responseString].map(ch => ch.charCodeAt(0)));
    // console.log("Do byte arrays match?: " + arraysMatch(responseBytes, responseStringToBytes));
}

function isUndefined(x) {
    return (typeof(x) === 'undefined' || x === null);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function arraysMatch(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;

    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

async function readNameservers() {
    let nameservers = [];
    try { 
        let platform = await browser.runtime.getPlatformInfo();
        if (platform.os == "mac") {
            nameservers = await browser.experiments.resolvconf.readNameserversMac();
        } else if (platform.os == "win") {
            nameservers = await browser.experiments.resolvconf.readNameserversWin();
        } else {
            // sendTelemetry({"event": "osNotSupported"});
            // throw new Error("OS not supported");
        }
    } catch(e) {
        // sendTelemetry({"event": "readNameserversError"});
        throw e;
    } 

    if (!Array.isArray(nameservers) || nameservers.length <= 0) {
        // sendTelemetry({"event": "noNameserversError"});
        throw new Error("No nameservers found");
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
        throw new Error("No IPv4 nameservers found");
    }
    console.log("IPv4 resolvers: ", nameservers_ipv4);
    return nameservers_ipv4;
}

async function setupUDPCode() {
    try {
        await browser.experiments.udpsocket.openSocket();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(processUDPResponse);
    } catch(e) {
        // sendTelemetry({"event": "openUDPSocketsError"});
        throw new Error("Couldn't set up UDP socket or event listener");
    }
}

async function sendQueries(nameservers_ipv4) {
    for (let i = 0; i < RRTYPES.length; i++) {
        let rrtype = RRTYPES[i];
        if (rrtype == 'SMIMEA') {
            await sendUDPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await sendTCPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype);
        } else if (rrtype == 'HTTPS') {
            await sendUDPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await sendTCPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype);
        } else {
            await sendUDPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype);
            await sendTCPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype);
        }
    }


    // TODO: Send Telemetry for DNS responses, ensuring that we convert the data to base64 strings if necessary
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
    try {
        payload["measurement_id"] = measurement_id;
        browser.telemetry.submitPing(TELEMETRY_TYPE, payload, TELEMETRY_OPTIONS);
    } catch(e) {
        throw new Error("Couldn't send telemetry for event " + payload["event"]);
    }
}

function cleanup() {
    browser.experiments.udpsocket.onDNSResponseReceived.removeListener(processUDPResponse);
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
    cleanup();
}

runMeasurement();
