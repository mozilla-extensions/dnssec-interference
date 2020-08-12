/* global browser */
const DNS_PACKET = require("dns-packet");
const { v4: uuidv4 } = require("uuid");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2a._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "_443._tcp.dnssec-experiment-moz.net";

const RRTYPES = ['A', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEWONE', 'NEWTWO'];
const RESOLVCONF_TIMEOUT = 5000; // 5 seconds
const RESOLVCONF_ATTEMPTS = 2; // Number of UDP attempts per nameserver. We let TCP handle re-transmissions on its own.

const TELEMETRY_TYPE = "dnssec-study-v1";
const TELEMETRY_OPTIONS = {
    addClientId: true,
    addEnvironment: true
};

const MAX_TXID = 65535;
const MIN_TXID = 0;

var measurement_id;

var dnsData = {
    udpA:      [],
    udpRRSIG:  [],
    udpDNSKEY: [],
    udpSMIMEA: [],
    udpHTTPS:  [],
    udpNEWONE: [],
    udpNEWTWO: [],
    tcpA:      [],
    tcpRRSIG:  [],
    tcpDNSKEY: [],
    tcpSMIMEA: [],
    tcpHTTPS:  [],
    tcpNEWONE: [],
    tcpNEWTWO: []
};

var dnsAttempts = {
    udpA:      0,
    udpRRSIG:  0,
    udpDNSKEY: 0,
    udpSMIMEA: 0,
    udpHTTPS:  0,
    udpNEWONE: 0,
    udpNEWTWO: 0,
    tcpA:      0,
    tcpRRSIG:  0,
    tcpDNSKEY: 0,
    tcpSMIMEA: 0,
    tcpHTTPS:  0,
    tcpNEWONE: 0,
    tcpNEWTWO: 0 
};

/**
 * Encode a DNS query to be sent over a UDP socket
 */
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
    return buf
}

/**
 * Encode a DNS query to be sent over a TCP socket
 */
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
    return buf;
}

/**
 * Send a DNS query over UDP, re-transmitting according to default 
 * resolvconf behavior if we fail to receive a response.
 *
 * In short, we re-transmit at most RESOLVCONF_ATTEMPTS for each nameserver 
 * we find. The timeout for each missing response is RESOLVCONF_TIMEOUT 
 * (5000 ms).
 */
async function sendUDPQuery(domain, nameservers, rrtype) {
    let buf = encodeUDPQuery(domain, rrtype);
    for (let nameserver of nameservers) {
        let written = 0;
        for (let j = 1; j <= RESOLVCONF_ATTEMPTS; j++) {
            try {
                dnsAttempts["udp" + rrtype] += 1
                written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype);
            } catch(e) {
                sendTelemetry({reason: "sendUDPQueryError",
                               errorRRTYPE: rrtype,
                               errorAttempt: dnsAttempts["udp" + rrtype]});
                console.log("DNSSEC Interference Study: Failure while sending UDP query");
                continue
            }
            await sleep(RESOLVCONF_TIMEOUT);

            if (written <= 0) {
                sendTelemetry({reason: "sendUDPQueryError",
                               errorRRTYPE: rrtype,
                               errorAttempt: dnsAttempts["udp" + rrtype]});
                console.log("DNSSEC Interference Study: No bytes written for UDP query");
                continue
            }

            if (dnsData["udp" + rrtype].length == 0) {
                console.log("DNSSEC Interference Study: No response received for UDP query");
                continue
            } else {
                return
            }
        }
    }
}

/**
 * Send a DNS query over TCP, re-transmitting to another nameserver if we 
 * fail to receive a response. We let TCP handle re-transmissions.
 */
async function sendTCPQuery(domain, nameservers, rrtype) {
    let buf = encodeTCPQuery(domain, rrtype);
    for (let nameserver of nameservers) {
        try {
            dnsAttempts["tcp" + rrtype] += 1;
            let response = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, buf);
            if (response.error_code != 0) {
                sendTelemetry({reason: "sendTCPQueryError",
                               errorRRTYPE: rrtype,
                               errorAttempt: dnsAttempts["tcp" + rrtype]});
                console.log("DNSSEC Interference Study: Failure while sending TCP query");
                continue
            }

            if (dnsData["tcp" + rrtype].length == 0) {
                dnsData["tcp" + rrtype] = response.data;
                console.log(rrtype + ": TCP response received");
            }
            return
        } catch (e) {
            console.log("DNSSEC Interference Study: Unknown error sending TCP query");
            continue
        }

    }
}

/**
 * Event listener that responds to packets that we receive from our UDP sockets
 */
function processUDPResponse(responseBytes, rrtype) {
    if (dnsData["udp" + rrtype].length == 0) {
        dnsData["udp" + rrtype] = responseBytes;
        console.log(rrtype + ": UDP response received");
    }
}

/**
 * Sleep implementation
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read the client's nameservers from disk.
 * If on macOS, read /etc/resolv.comf.
 * If on Windows, read a registry.
 */
async function readNameservers() {
    let nameservers = [];
    try { 
        let platform = await browser.runtime.getPlatformInfo();
        if (platform.os == "mac") {
            nameservers = await browser.experiments.resolvconf.readNameserversMac();
        } else if (platform.os == "win") {
            nameservers = await browser.experiments.resolvconf.readNameserversWin();
        } else {
            sendTelemetry({reason: "osNotSupportedError"});
            throw new Error("DNSSEC Interference Study: OS not supported");
        }
    } catch(e) {
        sendTelemetry({reason: "readNameserversFileError"});
        throw e;
    } 

    if (!nameservers.length) {
        sendTelemetry({reason: "noNameserversInFileError"});
        throw new Error("No nameservers found in /etc/resolv.conf or registry");
    }

    let nameservers_ipv4 = [];
    for (let nameserver of nameservers) {
        if (nameserver && /([0-9.]+)(\s|$)/.test(nameserver)) {
            nameservers_ipv4.push(nameserver);
        }
    }

    if (nameservers_ipv4.length <= 0) {
        sendTelemetry({reason: "noIPv4NameserversError"});
        throw new Error("DNSSEC Interference Study: No IPv4 nameservers found");
    }
    return nameservers_ipv4;
}

/**
 * Open the UDP sockets and add an event listener for when we receive UDP 
 * responses.
 */
async function setupUDPCode() {
    try {
        await browser.experiments.udpsocket.openSocket();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(processUDPResponse);
    } catch(e) {
        sendTelemetry({reason: "openUDPSocketsError"});
        throw new Error("DNSSEC Interference Study: Couldn't set up UDP socket or reason listener");
    }
}

/**
 * For each RR type that we have a DNS record for, attempt to send queries over 
 * UDP and TCP.
 */
async function sendQueries(nameservers_ipv4) {
    for (let rrtype of RRTYPES) {
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

    // Add the DNS responses as strings to an object, and send the object to telemetry
    let payload = {reason: "measurementCompleted"};
    payload.dnsData = dnsData;
    payload.dnsAttempts = dnsAttempts;
    sendTelemetry(payload);
}

/**
 * Add an ID to telemetry that corresponds with this instance of our 
 * measurement, i.e. a browser session
 */
function sendTelemetry(payload) {
    try {
        payload.measurement_id = measurement_id;
        browser.telemetry.submitPing(TELEMETRY_TYPE, payload, TELEMETRY_OPTIONS);
    } catch(e) {
        console.log("DNSSEC Interference Study: Couldn't send telemetry for reason " + payload[reason]);
    }
}

/**
 * Close UDP sockets once we're done with the measurement. The single TCP 
 * socket we use is opened/closed for each query/response.
 */
function cleanup() {
    browser.experiments.udpsocket.onDNSResponseReceived.removeListener(processUDPResponse);
}

/**
 * Entry point for our measurements.
 */
async function runMeasurement() {
    // Send a ping to indicate the start of the measurement
    measurement_id = uuidv4();
    sendTelemetry({reason: "startup"});

    let nameservers_ipv4 = await readNameservers();
    await setupUDPCode();
    await sendQueries(nameservers_ipv4);

    // Send a ping to indicate the end of the measurement
    sendTelemetry({reason: "end"});
    cleanup();
}

runMeasurement();
