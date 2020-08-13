/* global browser, Buffer */
const DNS_PACKET = require("dns-packet");
const { v4: uuidv4 } = require("uuid");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2a._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "dnssec-experiment-moz.net";

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
    const queryBuf = encodeUDPQuery(domain, rrtype);
    for (let nameserver of nameservers) {
        for (let j = 1; j <= RESOLVCONF_ATTEMPTS; j++) {
            try {
                dnsAttempts["udp" + rrtype] += 1
                let responseBytes = await browser.experiments.udpsocket.sendDNSQuery(nameserver, queryBuf, rrtype);
                // await sleep(RESOLVCONF_TIMEOUT);

                // If we don't already have a response saved in dnsData, save this one
                if (dnsData["udp" + rrtype].length == 0) {
                    dnsData["udp" + rrtype] = responseBytes;
                    const responseBuf = Buffer.from(responseBytes);
                    const decodedResponse = DNS_PACKET.decode(responseBuf);
                    console.log(rrtype + ": decoded UDP response");
                    console.log(decodedResponse);
                }
                // If we didn't get an error, return.
                // We don't need to re-transmit.
                return;
            } catch(e) {
                console.log("DNSSEC Interference Study: " + e.message);
                sendTelemetry({reason: "sendUDPQueryError",
                               errorRRTYPE: rrtype,
                               errorAttempt: dnsAttempts["udp" + rrtype]});
            }
        }
    }
}

/**
 * Send a DNS query over TCP, re-transmitting to another nameserver if we 
 * fail to receive a response. We let TCP handle re-transmissions.
 */
async function sendTCPQuery(domain, nameservers, rrtype) {
    const queryBuf = encodeTCPQuery(domain, rrtype);
    for (let nameserver of nameservers) {
        try {
            dnsAttempts["tcp" + rrtype] += 1;
            let responseBytes = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, queryBuf);

            // If we don't already have a response saved in dnsData, save this one
            if (dnsData["tcp" + rrtype].length == 0) {
                dnsData["tcp" + rrtype] = responseBytes;
                const responseBuf = Buffer.from(responseBytes);
                const decodedResponse = DNS_PACKET.streamDecode(responseBuf);
                console.log(rrtype + ": decoded TCP response");
                console.log(decodedResponse);
            }
            // If we didn't get an error, return.
            // We don't need to re-transmit.
            return;
        } catch (e) {
            console.log("DNSSEC Interference Study: " + e.message);
            sendTelemetry({reason: "sendTCPQueryError",
                           errorRRTYPE: rrtype,
                           errorAttempt: dnsAttempts["tcp" + rrtype]});
        }
    }
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
        throw new Error("DNSSEC Interference Study: No nameservers found");
    }
    return nameservers;
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
        console.log("DNSSEC Interference Study: Couldn't send telemetry");
    }
}

/**
 * Entry point for our measurements.
 */
async function runMeasurement() {
    // Send a ping to indicate the start of the measurement
    measurement_id = uuidv4();
    sendTelemetry({reason: "startup"});

    let nameservers_ipv4 = await readNameservers();
    await sendQueries(nameservers_ipv4);

    // Mark the end of the measurement by sending the DNS responses to telemetry
    let payload = {reason: "measurementCompleted"};
    payload.dnsData = dnsData;
    payload.dnsAttempts = dnsAttempts;
    sendTelemetry(payload);
}

runMeasurement();
