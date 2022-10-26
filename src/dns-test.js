/* global browser */ 
const DNS_PACKET = require("dns-packet");
const { v4: uuidv4 } = require("uuid");
const IP_REGEX = require("ip-regex");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_DOMAIN_NAME = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15._smimecert.dnssec-experiment-moz.net";
const HTTPS_DOMAIN_NAME = "httpssvc.dnssec-experiment-moz.net";

const RESOLVCONF_ATTEMPTS = 2; // Number of UDP attempts per nameserver. We let TCP handle re-transmissions on its own.

const COMMON_QUERIES = [
    { rrtype: "SMIMEA", domain: SMIMEA_DOMAIN_NAME, dnnssec_ok: false, checking_disabled: false },
    { rrtype: "HTTPS", domain: HTTPS_DOMAIN_NAME, dnnssec_ok: false, checking_disabled: false },
    { rrtype: "A", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "A", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: true },
    { rrtype: "A", domain: APEX_DOMAIN_NAME, dnssec_ok: true, checking_disabled: false },
    { rrtype: "A", domain: APEX_DOMAIN_NAME, dnssec_ok: true, checking_disabled: true },
    { rrtype: "DNSKEY", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "RRSIG", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "NEWONE", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "NEWTWO", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "NEWTHREE", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false },
    { rrtype: "NEWFOUR", domain: APEX_DOMAIN_NAME, dnssec_ok: false, checking_disabled: false }
];

const STUDY_START = "STUDY_START";
const STUDY_MEASUREMENT_COMPLETED = "STUDY_MEASUREMENT_COMPLETED";
const STUDY_ERROR_UDP_WEBEXT = "STUDY_ERROR_UDP_WEBEXT";
const STUDY_ERROR_UDP_MISC = "STUDY_ERROR_UDP_MISC";
const STUDY_ERROR_TCP_MISC = "STUDY_ERROR_TCP_MISC";
const STUDY_ERROR_UDP_ENCODE = "STUDY_ERROR_UDP_ENCODE";
const STUDY_ERROR_TCP_ENCODE = "STUDY_ERROR_TCP_ENCODE";
const STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED = "STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED";
const STUDY_ERROR_NAMESERVERS_NOT_FOUND = "STUDY_ERROR_NAMESERVERS_NOT_FOUND";
const STUDY_ERROR_NAMESERVERS_INVALID_ADDR = "STUDY_ERROR_NAMESERVERS_INVALID_ADDR";
const STUDY_ERROR_NAMESERVERS_MISC = "STUDY_ERROR_NAMESERVERS_MISC";
const STUDY_ERROR_CAPTIVE_PORTAL_FAILED = "STUDY_ERROR_CAPTIVE_PORTAL_FAILED";
const STUDY_ERROR_CAPTIVE_PORTAL_API_DISABLED = "STUDY_ERROR_CAPTIVE_PORTAL_API_DISABLED";
const STUDY_ERROR_TELEMETRY_CANT_UPLOAD = "STUDY_ERROR_TELEMETRY_CANT_UPLOAD";
const STUDY_ERROR_FETCH_FAILED = "STUDY_ERROR_FETCH_FAILED";
const STUDY_ERROR_FETCH_NOT_MATCHED = "STUDY_ERROR_FETCH_NOT_MATCHED";

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
    udpACD:       [],
    udpADO:       [],
    udpADOCD:     [],
    udpRRSIG:     [],
    udpDNSKEY:    [],
    udpSMIMEA:    [],
    udpHTTPS:     [],
    udpNEWONE:    [],
    udpNEWTWO:    [],
    udpNEWTHREE:  [],
    udpNEWFOUR:   [],
    tcpA:         [],
    tcpACD:       [],
    tcpADO:       [],
    tcpADOCD:     [],
    tcpRRSIG:     [],
    tcpDNSKEY:    [],
    tcpSMIMEA:    [],
    tcpHTTPS:     [],
    tcpNEWONE:    [],
    tcpNEWTWO:    [],
    tcpNEWTHREE:  [],
    tcpNEWFOUR:   []
};

var dnsAttempts = {
    udpAWebExt:  0,
    udpA:        0,
    udpACD:      0,
    udpADO:      0,
    udpADOCD:    0,
    udpRRSIG:    0,
    udpDNSKEY:   0,
    udpSMIMEA:   0,
    udpHTTPS:    0,
    udpNEWONE:   0,
    udpNEWTWO:   0,
    udpNEWTHREE: 0,
    udpNEWFOUR:  0,
    tcpA:        0,
    tcpACD:      0,
    tcpADO:      0,
    tcpADOCD:    0,
    tcpRRSIG:    0,
    tcpDNSKEY:   0,
    tcpSMIMEA:   0,
    tcpHTTPS:    0,
    tcpNEWONE:   0,
    tcpNEWTWO:   0,
    tcpNEWTHREE: 0,
    tcpNEWFOUR:  0
};

function logMessage(m) {
    console.log(m);
}    
    
/**
 * Shuffle an array
 * Borrowed from https://stackoverflow.com/a/2450976
 */
function shuffleArray(array) {
    let currentIndex = array.length;
    let randomIndex;

    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
}

/**
 * Encode a DNS query to be sent over a UDP socket
 */
function encodeUDPQuery(domain, rrtype, dnssec_ok, checking_disabled) {
    let buf;
    let type = 'query';
    let id = Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID;    // Generate a random transaction ID between 0 and 65535
    let flags = DNS_PACKET.RECURSION_DESIRED;
    let questions = [{ type: rrtype, name: domain }];
    let additionals = [{ type: 'OPT', name: '.', udpPayloadSize: UDP_PAYLOAD_SIZE }];
    
    if (checking_disabled) {
        flags = flags | DNS_PACKET.CHECKING_DISABLED;
    }
    if (dnssec_ok) {
        additionals = [{ type: 'OPT', name: '.', udpPayloadSize: UDP_PAYLOAD_SIZE, flags: DNS_PACKET.DNSSEC_OK }];
    }

    buf = DNS_PACKET.encode({
        type: type,
        id: id,
        flags: flags,
        questions: questions,
        additionals: additionals
    });
    return buf
}

/**
 * Encode a DNS query to be sent over a TCP socket
 */
function encodeTCPQuery(domain, rrtype, dnssec_ok, checking_disabled) {
    let buf;
    let type = 'query';
    let id = Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID;    // Generate a random transaction ID between 0 and 65535
    let flags = DNS_PACKET.RECURSION_DESIRED;
    let questions = [{ type: rrtype, name: domain }];
    let additionals = null;
    
    if (checking_disabled) {
        flags = flags | DNS_PACKET.CHECKING_DISABLED;
    }
    if (dnssec_ok) {
        additionals = [{ type: 'OPT', name: '.', flags: DNS_PACKET.DNSSEC_OK }];
    }

    buf = DNS_PACKET.streamEncode({
        type: type,
        id: id,
        flags: flags,
        questions: questions,
        additionals: additionals
    });
    return buf
}

/**
 * Send a DNS query for an A record over UDP using the WebExtensions
 * dns.resolve() API
 *
 * We query a random sub-domain under a domain name we control to ensure
 * that our queries are not answered by the OS DNS cache. We do not seem
 * to experience the same issue with the internal UDP/TCP APIs because
 * they are not calling getaddrinfo().
 *
 * We let the underlying API handle re-transmissions and which nameserver is 
 * used. We make sure that DoH is not used and that A records are queried, 
 * rather than AAAA.
 */
async function sendUDPWebExtQuery(domain) {
    let key = "udpAWebExt";
    let errorKey = "AWebExt";
    let flags = ["bypass_cache", "disable_ipv6", "disable_trr"];

    try {
        dnsAttempts[key] += 1
        let response = await browser.dns.resolve(domain, flags);
        // If we don't already have a response saved in dnsData, save this one
        if (dnsData[key].length == 0) {
            dnsData[key] = response.addresses;
        }
        return;
    } catch(e) {
        logMessage("DNS resolution failed " + e);
        let errorReason = STUDY_ERROR_UDP_WEBEXT;
        sendTelemetry({reason: errorReason,
                       errorRRTYPE: errorKey,
                       errorAttempt: dnsAttempts[key]});
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
async function sendUDPQuery(domain, nameservers, rrtype, dnssec_ok, checking_disabled) {
    let queryBuf;
    try {
        queryBuf = encodeUDPQuery(domain, rrtype, dnssec_ok, checking_disabled);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_UDP_ENCODE});
        throw new Error(STUDY_ERROR_UDP_ENCODE);
    }

    let key = "udp" + rrtype;
    let errorKey = rrtype;
    if (dnssec_ok) {
        key = key + "DO";
        errorKey = errorKey + "DO";
    }
    if (checking_disabled) {
        key = key + "CD";
        errorKey = errorKey + "CD";
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
async function sendTCPQuery(domain, nameservers, rrtype, dnssec_ok, checking_disabled) {
    let queryBuf;
    try {
        queryBuf = encodeTCPQuery(domain, rrtype, dnssec_ok, checking_disabled);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_TCP_ENCODE});
        throw new Error(STUDY_ERROR_TCP_ENCODE);
    }

    let key = "tcp" + rrtype;
    let errorKey = rrtype;
    if (dnssec_ok) {
        key = key + "DO";
        errorKey = errorKey + "DO";
    }
    if (checking_disabled) {
        key = key + "CD";
        errorKey = errorKey + "CD";
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
            sendTelemetry({reason: STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED});
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
            sendTelemetry({reason: STUDY_ERROR_NAMESERVERS_INVALID_ADDR});
            throw new Error(STUDY_ERROR_NAMESERVERS_INVALID_ADDR);
        }
    }
    return nameservers;
}

/**
 * For each RR type that we have a DNS record for, attempt to send queries over 
 * UDP and TCP.
 */
async function sendQueries(nameservers_ipv4) {
    // Add a query for our A record that uses the WebExtensions dns.resolve API as a baseline
    let queries = [];
    queries.push(() => sendUDPWebExtQuery(APEX_DOMAIN_NAME));

    // Add the remaining queries that use the browser's internal socket APIs
    for (let { rrtype, domain, dnssec_ok, checking_disabled } of COMMON_QUERIES) {
        let args = [domain, nameservers_ipv4, rrtype, dnssec_ok, checking_disabled];
        queries.push(() => sendUDPQuery(...args));
        queries.push(() => sendTCPQuery(...args));
    }

    // Shuffle the order of the array of queries, and then send the queries
    shuffleArray(queries);
    for (let sendQuery of queries) {
        await sendQuery();
    }
}

/**
 * Add an ID to telemetry that corresponds with this instance of our
 * measurement, i.e. a browser session
 */
function sendTelemetry(payload) {
    logMessage("Sending telemetry");
    logMessage(payload);
    payload.measurementID = measurementID;
    browser.telemetry.submitPing(TELEMETRY_TYPE, payload, TELEMETRY_OPTIONS);
}

async function fetchTest() {
    // TODO(ekr@rtfm.com): the test page is down
    return;
    
    let response;
    let responseText;
    try {
        response = await fetch("https://dnssec-experiment-moz.net/", {cache: "no-store"});
        responseText = await response.text();
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_FETCH_FAILED});
        throw new Error(STUDY_ERROR_FETCH_FAILED);
    }
    if (responseText !== "Hello, world!\n") {
        sendTelemetry({reason: STUDY_ERROR_FETCH_NOT_MATCHED});
        throw new Error(STUDY_ERROR_FETCH_NOT_MATCHED);
    }
}

/**
 * Entry point for our measurements.
 */
async function runMeasurement(details) {
    /**
     * Only proceed if we're not behind a captive portal, as determined by
     * browser.captivePortal.getState() and browser.captivePortal.onConnectivityAvailable.addListener().
     *
     * Possible states for browser.captivePortal.getState():
     * unknown, not_captive, unlocked_portal, or locked_portal.
     *
     * Possible states passed to the callback for browser.captivePortal.onConnectivityAvailable.addListener():
     * captive or clear.
     */
    let captiveStatus = details.status;
    if ((captiveStatus !== "unlocked_portal") &&
        (captiveStatus !== "not_captive") &&
        (captiveStatus !== "clear")) {
        sendTelemetry({reason: STUDY_ERROR_CAPTIVE_PORTAL_FAILED});
        throw new Error(STUDY_ERROR_CAPTIVE_PORTAL_FAILED);
    }

    // After we've determine that we are online, run the fetch test
    await fetchTest();

    // Send a ping to indicate the start of the measurement
    sendTelemetry({reason: STUDY_START});

    let nameservers_ipv4 = await readNameservers();
    await sendQueries(nameservers_ipv4);

    // Mark the end of the measurement by sending the DNS responses to telemetry
    let payload = {reason: STUDY_MEASUREMENT_COMPLETED};
    payload.dnsData = dnsData;
    payload.dnsAttempts = dnsAttempts;

    // Run the fetch test one more time before submitting our measurements
    await fetchTest();

    // If we have passed the XHR test a second time, submit our measurements
    sendTelemetry(payload);
}

/**
 * Entry point for our addon.
 */
async function main() {
    measurementID = uuidv4();

    // If we can't upload telemetry. don't run the addon
    let canUpload = await browser.telemetry.canUpload();
    if (!canUpload) {
        throw new Error(STUDY_ERROR_TELEMETRY_CANT_UPLOAD);
    }

    // Use the captive portal API to determine if we have Internet connectivity.
    // If we already have connectivity, run the measurement.
    // If not, wait until we get connectivity to run it.
    let captiveStatus;
    try {
        captiveStatus = await browser.captivePortal.getState();
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_CAPTIVE_PORTAL_API_DISABLED});
        throw new Error(STUDY_ERROR_CAPTIVE_PORTAL_API_DISABLED);
    }


    // Possible states for browser.captivePortal.getState():
    // unknown, not_captive, unlocked_portal, or locked_portal.
    if ((captiveStatus === "unlocked_portal") ||
        (captiveStatus === "not_captive")) {
        await runMeasurement({status: captiveStatus});
        return;
    }

    browser.captivePortal.onConnectivityAvailable.addListener(function listener(details) {
        browser.captivePortal.onConnectivityAvailable.removeListener(listener);
        runMeasurement(details);
    });
}

main();
