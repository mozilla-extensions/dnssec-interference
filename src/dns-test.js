/* global browser */ 
const DNS_PACKET = require("dns-packet");
const { v4: uuidv4 } = require("uuid");
const IP_REGEX = require("ip-regex");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "httpssvc.dnssec-experiment-moz.net";

const RRTYPES = ['A', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEWONE', 'NEWTWO'];
const RESOLVCONF_ATTEMPTS = 2; // Number of UDP attempts per nameserver. We let TCP handle re-transmissions on its own.

const STUDY_START = "STUDY_START";
const STUDY_MEASUREMENT_COMPLETED = "STUDY_MEASUREMENT_COMPLETED";
const STUDY_ERROR_UDP_MISC = "STUDY_ERROR_UDP_MISC";
const STUDY_ERROR_TCP_MISC = "STUDY_ERROR_TCP_MISC";
const STUDY_ERROR_UDP_ENCODE = "STUDY_ERROR_UDP_ENCODE";
const STUDY_ERROR_TCP_ENCODE = "STUDY_ERROR_TCP_ENCODE";
const STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED = "STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED";
const STUDY_ERROR_NAMESERVERS_NOT_FOUND = "STUDY_ERROR_NAMESERVERS_NOT_FOUND";
const STUDY_ERROR_NAMESERVERS_INVALID = "STUDY_ERROR_NAMESERVERS_INVALID";
const STUDY_ERROR_NAMESERVERS_MISC = "STUDY_ERROR_NAMESERVERS_MISC";
const STUDY_ERROR_XHR_NOT_MATCHED = "STUDY_ERROR_XHR_NOT_MATCHED";
const STUDY_ERROR_XHR_ERROR = "STUDY_ERROR_XHR_ERROR";
const STUDY_ERROR_XHR_ABORTED = "STUDY_ERROR_XHR_ABORTED";
const STUDY_ERROR_XHR_TIMEOUT = "STUDY_ERROR_XHR_TIMEOUT";

const TELEMETRY_TYPE = "dnssec-study-v1";
const TELEMETRY_OPTIONS = {
    addClientId: true,
    addEnvironment: true
};

const MAX_TXID = 65535;
const MIN_TXID = 0;

const UDP_PAYLOAD_SIZE = 4096;

var measurementID;

var dnsData = {
    udpAWebExt:   [],
    udpA:         [],
    udpADO:       [],
    udpRRSIG:     [],
    udpDNSKEY:    [],
    udpSMIMEA:    [],
    udpHTTPS:     [],
    udpNEWONE:    [],
    udpNEWTWO:    [],
    tcpA:         [],
    tcpADO:       [],
    tcpRRSIG:     [],
    tcpDNSKEY:    [],
    tcpSMIMEA:    [],
    tcpHTTPS:     [],
    tcpNEWONE:    [],
    tcpNEWTWO:    []
};

var dnsAttempts = {
    udpAWebExt: 0,
    udpA:       0,
    udpADO:     0,
    udpRRSIG:   0,
    udpDNSKEY:  0,
    udpSMIMEA:  0,
    udpHTTPS:   0,
    udpNEWONE:  0,
    udpNEWTWO:  0,
    tcpA:       0,
    tcpADO:     0,
    tcpRRSIG:   0,
    tcpDNSKEY:  0,
    tcpSMIMEA:  0,
    tcpHTTPS:   0,
    tcpNEWONE:  0,
    tcpNEWTWO:  0
};

/**
 * Encode a DNS query to be sent over a UDP socket
 */
function encodeUDPQuery(domain, rrtype, dnssec_ok) {
    let buf;
    if (dnssec_ok) {
        buf = DNS_PACKET.encode({
            type: 'query',
            // Generate a random transaction ID between 0 and 65535
            id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{ type: rrtype, name: domain }],
            additionals: [{ type: 'OPT', name: '.', udpPayloadSize: UDP_PAYLOAD_SIZE, flags: DNS_PACKET.DNSSEC_OK }]
        });
    } else {
        buf = DNS_PACKET.encode({
            type: 'query',
            // Generate a random transaction ID between 0 and 65535
            id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{ type: rrtype, name: domain }],
            additionals: [{ type: 'OPT', name: '.', udpPayloadSize: UDP_PAYLOAD_SIZE }]
        });
    }
    return buf
}

/**
 * Encode a DNS query to be sent over a TCP socket
 */
function encodeTCPQuery(domain, rrtype, dnssec_ok) {
    let buf;
    if (dnssec_ok) {
        buf = DNS_PACKET.streamEncode({
            type: 'query',
            // Generate a random transaction ID between 0 and 65535
            id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{ type: rrtype, name: domain }],
            additionals: [{ type: 'OPT', name: '.', flags: DNS_PACKET.DNSSEC_OK }]
        });
    } else {
        buf = DNS_PACKET.streamEncode({
            type: 'query',
            // Generate a random transaction ID between 0 and 65535
            id: Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID,
            flags: DNS_PACKET.RECURSION_DESIRED,
            questions: [{ type: rrtype, name: domain }]
        });
    }
    return buf;
}

/**
 * Send a DNS query over UDP using the WebExtensions dns.resolve API, 
 * re-transmitting according to default resolvconf behavior if the API 
 * returns an error.
 *
 * We re-transmit at most RESOLVCONF_ATTEMPTS. We let the 
 * underlying API handle which nameserver is used. We make that DoH is not 
 * used and that A records are queried, rather than AAAA.
 */
async function sendUDPWebExtQuery(domain) {
    let key = "udpAWebExt";
    let errorKey = "AWebExt";
    let flags = ["bypass_cache", "disable_ipv6", "disable_trr"];
    for (let i = 1; i <= RESOLVCONF_ATTEMPTS; i++) {
        try {
            dnsAttempts[key] += 1
            let response = await browser.dns.resolve(domain, flags);
            // If we don't already have a response saved in dnsData, save this one
            if (dnsData[key].length == 0) {
                dnsData[key] = response.addresses;
            }
            return;
        } catch(e) {
            let errorReason = "STUDY_ERROR_UDP_WEBEXT";
            sendTelemetry({reason: errorReason,
                           errorRRTYPE: errorKey,
                           errorAttempt: dnsAttempts[key]});
        }
    }
}

/**
 * Send a DNS query over UDP, re-transmitting according to default 
 * resolvconf behavior if we fail to receive a response.
 *
 * In short, we re-transmit at most RESOLVCONF_ATTEMPTS for each nameserver 
 * we find. The timeout for each missing response is RESOLVCONF_TIMEOUT 
 * (5000 ms).
 */
async function sendUDPQuery(domain, nameservers, rrtype, dnssec_ok) {
    let queryBuf;
    try {
        queryBuf = encodeUDPQuery(domain, rrtype, dnssec_ok);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_UDP_ENCODE});
        throw new Error(STUDY_ERROR_UDP_ENCODE);
    }

    let key;
    let errorKey;
    if (dnssec_ok) {
        key = "udp" + rrtype + "DO"; 
        errorKey = rrtype + "DO";
    } else {
        key = "udp" + rrtype;
        errorKey = rrtype;
    }

    for (let i = 1; i <= RESOLVCONF_ATTEMPTS; i++) {
        for (let nameserver of nameservers) {
            try {
                dnsAttempts[key] += 1
                let responseBytes = await browser.experiments.udpsocket.sendDNSQuery(nameserver, queryBuf, rrtype);

                // If we don't already have a response saved in dnsData, save this one
                if (dnsData[key].length == 0) {
                    dnsData[key] = Array.from(responseBytes);
                }
                // If we didn't get an error, return.
                // We don't need to re-transmit.
                return;
            } catch(e) {
                let errorReason;
                if (e.message.startsWith("STUDY_ERROR_UDP")) {
                    errorReason = e.message;
                } else {
                    errorReason = STUDY_ERROR_UDP_MISC;
                }
                sendTelemetry({reason: errorReason,
                               errorRRTYPE: errorKey,
                               errorAttempt: dnsAttempts[key]});
            }
        }
    }
}

/**
 * Send a DNS query over TCP, re-transmitting to another nameserver if we 
 * fail to receive a response. We let TCP handle re-transmissions.
 */
async function sendTCPQuery(domain, nameservers, rrtype, dnssec_ok) {
    let queryBuf;
    try {
        queryBuf = encodeTCPQuery(domain, rrtype, dnssec_ok);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_TCP_ENCODE});
        throw new Error(STUDY_ERROR_TCP_ENCODE);
    }

    let key;
    let errorKey;
    if (dnssec_ok) {
        key = "tcp" + rrtype + "DO"; 
        errorKey = rrtype + "DO";
    } else {
        key = "tcp" + rrtype;
        errorKey = rrtype;
    }

    for (let nameserver of nameservers) {
        try {
            dnsAttempts[key] += 1;
            let responseBytes = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, queryBuf);

            // If we don't already have a response saved in dnsData, save this one
            if (dnsData[key].length == 0) {
                dnsData[key] = Array.from(responseBytes);
            }
            // If we didn't get an error, return.
            // We don't need to re-transmit.
            return;
        } catch (e) {
            let errorReason;
            if (e.message.startsWith("STUDY_ERROR_TCP")) {
                errorReason = e.message;
            } else {
                errorReason = STUDY_ERROR_TCP_MISC;
            }
            sendTelemetry({reason: errorReason,
                           errorRRTYPE: errorKey,
                           errorAttempt: dnsAttempts[key]});

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
            throw new Error(STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED);
        }
    } catch(e) {
        let errorReason;
        if (e.message.startsWith("STUDY_ERROR_NAMESERVERS")) {
            errorReason = e.message;
        } else {
            errorReason = STUDY_ERROR_NAMESERVERS_MISC;
        }
        sendTelemetry({reason: errorReason});
        throw new Error(errorReason);
    }

    if (!(nameservers && nameservers.length)) {
        sendTelemetry({reason: STUDY_ERROR_NAMESERVERS_NOT_FOUND});
        throw new Error(STUDY_ERROR_NAMESERVERS_NOT_FOUND);
    }

    for (let nameserver of nameservers) {
        let valid = IP_REGEX({exact: true}).test(nameserver);
        if (!valid) {
            sendTelemetry({reason: STUDY_ERROR_NAMESERVERS_INVALID});
            throw new Error(STUDY_ERROR_NAMESERVERS_INVALID);
        }
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
            await sendUDPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
            await sendTCPQuery(SMIMEA_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
        } else if (rrtype == 'HTTPS') {
            await sendUDPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
            await sendTCPQuery(HTTPS_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
        } else if (rrtype == 'A') {
            // First send queries using the WebExtensions dns.resolve API as a baseline
            await sendUDPWebExtQuery(APEX_DOMAIN_NAME);

            // Then send queries using our experimental APIs with the DNSSEC OK bit, then without
            await sendUDPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, true);
            await sendTCPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, true);
            await sendUDPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
            await sendTCPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
        } else {
            await sendUDPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
            await sendTCPQuery(APEX_DOMAIN_NAME, nameservers_ipv4, rrtype, false);
        }
    }
}

/**
 * Add an ID to telemetry that corresponds with this instance of our
 * measurement, i.e. a browser session
 */
function sendTelemetry(payload) {
    payload.measurementID = measurementID;
    console.log(payload);
    // browser.telemetry.submitPing(TELEMETRY_TYPE, payload, TELEMETRY_OPTIONS);
}

function xhrLoadListener() {
    let responseText = this.responseText;
    console.log(responseText);
    if (!(responseText && responseText === "Hello, world!\n")) {
        // sendTelemetry({reason: STUDY_ERROR_XHR_NOT_MATCHED});
        throw new Error(STUDY_ERROR_XHR_NOT_MATCHED);
    }
}

function xhrErrorListener() {
    // sendTelemetry({reason: STUDY_ERROR_XHR_ERROR});
    throw new Error(STUDY_ERROR_XHR_ERROR);
}

function xhrAbortListener() {
    // sendTelemetry({reason: STUDY_ERROR_XHR_ABORTED});
    throw new Error(STUDY_ERROR_XHR_ABORTED);
}

function xhrTimeoutListener() {
    // sendTelemetry({reason: STUDY_ERROR_XHR_TIMEOUT});
    throw new Error(STUDY_ERROR_XHR_TIMEOUT);
}

function xhrTest() {
    let xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    xhr.addEventListener("load", xhrLoadListener);
    xhr.addEventListener("error", xhrErrorListener);
    xhr.addEventListener("abort", xhrAbortListener);
    xhr.addEventListener("timeout", xhrTimeoutListener);
    xhr.open("GET", "https://dnssec-experiment-moz.net/")
    xhr.send();
}

/**
 * Entry point for our measurements.
 */
async function runMeasurement(details) {
    // Now that we're here, stop listening to the captive portal
    browser.captivePortal.onConnectivityAvailable.removeListener(runMeasurement);

    // Only proceed if we're not behind a captive portal
    let captiveStatus = details.status;
    if ((captiveStatus !== "unlocked_portal") &&
        (captiveStatus !== "not_captive") &&
        (captiveStatus !== "clear")) {
        return;
    }

    // After we've determine that we are online, run the XHR test
    xhrTest();

    // Send a ping to indicate the start of the measurement
    measurementID = uuidv4();
    sendTelemetry({reason: STUDY_START});

    let nameservers_ipv4 = await readNameservers();
    await sendQueries(nameservers_ipv4);

    // Mark the end of the measurement by sending the DNS responses to telemetry
    let payload = {reason: STUDY_MEASUREMENT_COMPLETED};
    payload.dnsData = dnsData;
    payload.dnsAttempts = dnsAttempts;

    // Run the XHR test one more time before submitting our measurements
    xhrTest();

    // If we have passed the XHR test a second time, submit our measurements
    sendTelemetry(payload);
}

/**
 * Entry point for our addon.
 */
async function main() {
    // If we can't upload telemetry. don't run the addon
    let canUpload = await browser.telemetry.canUpload();
    if (!canUpload) {
        return;
    }

    // Use the captive portal API to determine if we have Internet connectivity.
    // If we already have connectivity, run the measurement.
    // If not, wait until we get connectivity to run it.
    let captiveStatus = await browser.captivePortal.getState();
    if ((captiveStatus === "unlocked_portal") ||
        (captiveStatus === "not_captive") ||
        (captiveStatus === "clear")) {
        await runMeasurement({status: captiveStatus});
        return;
    }

    browser.captivePortal.onConnectivityAvailable.addListener(runMeasurement);
}

main();
