/* global browser */
const DNS_PACKET = require("dns-packet");
const { Buffer } = require("buffer");
const { v4: uuidv4 } = require("uuid");
const IP_REGEX = require("ip-regex");

const APEX_DOMAIN_NAME = "dnssec-experiment-moz.net";
const SMIMEA_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15";
const EXPECTED_FETCH_RESPONSE = "Hello, world!\n";

const RESOLVCONF_ATTEMPTS = 2; // Number of UDP attempts per nameserver. We let TCP handle re-transmissions on its own.

/**
 * @typedef {Object} QueryConfig
 * @property {string} rrtype - Record type. e.g., "A"
 * @property {string=} prefix - Domain prefix. Defaults to ""
 * @property {string=} perClientPrefix - Domain prefix for per-client variant. Defaults to "pc"
 * @property {boolean=} dnssec_ok - Flag
 * @property {boolean=} checking_disabled - Flag
 * @property {boolean=} noedns0 - Flag
 */

/** @type QueryConfig[] */
const COMMON_QUERIES = [
    { rrtype: "SMIMEA", prefix: SMIMEA_HASH + "._smimecert", perClientPrefix: "_smimecert.pc"},
    { rrtype: "HTTPS", prefix: "httpssvc", perClientPrefix: "httpssvc-pc"},
    { rrtype: "A"},
    { rrtype: "A", noedns0: true },
    { rrtype: "A", checking_disabled: true },
    { rrtype: "A", dnssec_ok: true },
    { rrtype: "A", dnssec_ok: true, checking_disabled: true },
    { rrtype: "DNSKEY", dnssec_ok: true },
    { rrtype: "DS"},
    { rrtype: "NEWONE"},
    { rrtype: "NEWTWO"},
    { rrtype: "NEWTHREE"},
    { rrtype: "NEWFOUR"}
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

var loggingEnabled;
var measurementID;

var dnsData = {};

var dnsAttempts = {};

var dnsQueryErrors = [];

// For tests
function resetState() {
    dnsData = {};
    dnsAttempts = {};
    dnsQueryErrors = [];
}

function logMessage(...args) {
    if (loggingEnabled) {
        console.log(...args);
    }
}

function logError(...args) {
    if (loggingEnabled) {
        console.error(...args);
    }
}

function assert(isTrue, message) {
    if (!isTrue) {
        throw new Error(message);
    }
}

function stringifyAndTruncate(data) {
    let str = "";
    try {
        str = JSON.stringify(data);
    } catch (e) {
        logMessage("Could not stringify data", data);
    }
    return str.length > 50 ? `${str.slice(0, 50)}...` : str;
}

/**
 *
 *
 * @param {ArrayBuffer|string} resp A response from one of the DNSQuery api helpers
 * @param {string} key The key of the query via computeKey
 * @param {"tcp"|"udp"} [transport] Optional. If this is omitted, the response won't be parsed.
 * @returns
 */
function logDNSResponse(resp, key, transport) {
    if (!loggingEnabled) {
        return;
    }
    try {
        let parsed;
        if (transport === "tcp") {
            parsed = DNS_PACKET.streamDecode(Buffer.from(resp));
        } else if (transport === "udp") {
            parsed = DNS_PACKET.decode(Buffer.from(resp));
        }
        if (parsed) {
            const hasAnswers = parsed.answers?.length > 0;
            logMessage(
                `DNS Query for ${key}:\n` +
                `[Q] ${parsed.questions?.map(({name, type}) => `${type} ${name}`).join(",")}\n` +
                `%c[A] ${parsed.answers?.map(({name, type, data}) => `${type} ${name} $${stringifyAndTruncate(data)}`).join("\n    ") || "No answers\n"} `,
                (hasAnswers ? 'color: green;' : 'color: red;'),
            );
        } else {
            logMessage("Control DNS Query", resp);
        }
    } catch (error) {
        console.warn("Could not log DNS response");
        console.error(error);
    }
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
 * @param {string} domain
 * @param {QueryConfig} query
 */
function encodeUDPQuery(domain, { rrtype, dnssec_ok, checking_disabled, noedns0 }) {
    let buf;
    let type = 'query';
    let id = Math.floor(Math.random() * (MAX_TXID - MIN_TXID + 1)) + MIN_TXID;    // Generate a random transaction ID between 0 and 65535
    let flags = DNS_PACKET.RECURSION_DESIRED;
    let questions = [{ type: rrtype, name: domain }];
    let additionals = noedns0 ? [] : [{ type: 'OPT', name: '.', udpPayloadSize: UDP_PAYLOAD_SIZE }];

    if (checking_disabled) {
        flags = flags | DNS_PACKET.CHECKING_DISABLED;
    }
    if (dnssec_ok) {
        // TODO(ekr@rtfm.com): Assert noedns0
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
 * @param {string} domain
 * @param {QueryConfig} query
 */
function encodeTCPQuery(domain, {rrtype, dnssec_ok, checking_disabled}) {
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


const sendDNSQuery = {};
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
sendDNSQuery.system = async (domain) => {
    let key = "udpAWebExt";
    let flags = ["bypass_cache", "disable_ipv6", "disable_trr"];

    try {
        dnsAttempts[key] = (dnsAttempts[key] || 0) + 1
        let response = await browser.dns.resolve(domain, flags);
        logDNSResponse(response.addresses, key);
        // If we don't already have a response saved in dnsData, save this one
        if (!dnsData[key]) {
            dnsData[key] = response.addresses;
        }
        return;
    } catch(e) {
        logError(e, "DNS resolution failed");
        let errorReason = STUDY_ERROR_UDP_WEBEXT;
        dnsQueryErrors.push({reason: errorReason,
                    errorRRTYPE: key,
                    errorAttempt: dnsAttempts[key]});
    }
};

/**
 * Send a DNS query over UDP, re-transmitting according to default
 * resolvconf behavior if we fail to receive a response.
 *
 * In short, we re-transmit at most RESOLVCONF_ATTEMPTS for each nameserver
 * we find. The timeout for each missing response is RESOLVCONF_TIMEOUT
 * (5000 ms).
 */
 sendDNSQuery.udp = async (key, domain, query, nameservers) => {
    let { rrtype } = query;

    logMessage("UDP: " + rrtype + "? " + domain + " " + key);
    let queryBuf;
    try {
        queryBuf = encodeUDPQuery(domain, query);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_UDP_ENCODE});
        throw new Error(STUDY_ERROR_UDP_ENCODE);
    }

    for (let i = 1; i <= RESOLVCONF_ATTEMPTS; i++) {
        for (let nameserver of nameservers) {
            try {
                dnsAttempts[key] = (dnsAttempts[key] || 0) + 1;
                let responseBytes = await browser.experiments.udpsocket.sendDNSQuery(nameserver, queryBuf, rrtype);
                logDNSResponse(responseBytes, key, "udp");

                // If we don't already have a response saved in dnsData, save this one
                if (!dnsData[key]) {
                    dnsData[key] = Array.from(responseBytes);
                }
                // If we didn't get an error, return.
                // We don't need to re-transmit.
                return;
            } catch(e) {
                logError(e);
                let errorReason;
                if (e.message.startsWith("STUDY_ERROR_UDP")) {
                    errorReason = e.message;
                } else {
                    errorReason = STUDY_ERROR_UDP_MISC;
                }
                dnsQueryErrors.push({reason: errorReason,
                            errorRRTYPE: key,
                            errorAttempt: dnsAttempts[key]});
            }
        }
    }
};

/**
 * Send a DNS query over TCP, re-transmitting to another nameserver if we
 * fail to receive a response. We let TCP handle re-transmissions.
 */
sendDNSQuery.tcp = async (key, domain, query, nameservers) => {
    let { rrtype } = query;
    logMessage("TCP: " + rrtype + "? " + domain + " " + key);
    let queryBuf;
    try {
        queryBuf = encodeTCPQuery(domain, query);
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_TCP_ENCODE});
        throw new Error(STUDY_ERROR_TCP_ENCODE);
    }

    for (let nameserver of nameservers) {
        try {
            dnsAttempts[key] = (dnsAttempts[key] || 0) + 1;
            let responseBytes = await browser.experiments.tcpsocket.sendDNSQuery(nameserver, queryBuf);
            logDNSResponse(responseBytes, key, "tcp");

            // If we don't already have a response saved in dnsData, save this one
            if (!dnsData[key]) {
                dnsData[key] = Array.from(responseBytes);
            }
            // If we didn't get an error, return.
            // We don't need to re-transmit.
            return;
        } catch (e) {
            logError(e);
            let errorReason;
            if (e.message.startsWith("STUDY_ERROR_TCP")) {
                errorReason = e.message;
            } else {
                errorReason = STUDY_ERROR_TCP_MISC;
            }
            dnsQueryErrors.push({reason: errorReason,
                        errorRRTYPE: key,
                        errorAttempt: dnsAttempts[key]});

        }
    }
};

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

    logMessage("Nameservers: " + nameservers);
    return nameservers;
}

/**
 * @param {"udp"|"tcp"} transport
 * @param {QueryConfig} args
 * @param {boolean} [perClient]
 * @returns {string}
 */
function computeKey(transport, args, perClient) {
    let tmp = transport + "-" + args.rrtype;
    if (args.dnssec_ok) {
        tmp += "DO";
    }
    if (args.checking_disabled) {
        tmp += "CD";
    }
    if (args.noedns0) {
        tmp += "-N";
    }
    if (perClient) {
        tmp += "-U";
    }

    return tmp;
}

/**
 * @param {string} key
 * @param {QueryConfig} query
 * @param {boolean} perClient
 * @returns string
 */
function computeDomain(key, {prefix = "", perClientPrefix = "pc"}, perClient) {
    if (perClient) {
        return `${key}-${measurementID}.${perClientPrefix}.${APEX_DOMAIN_NAME}`;
    } else {
        return `${prefix}.${APEX_DOMAIN_NAME}`;
    }
}

function sendQueryFactory(transport, query, nameservers_ipv4, perClient) {
    const key = computeKey(transport, query, perClient);
    const domain = computeDomain(key, query, perClient);
    assert(transport in sendDNSQuery, `${transport} is not a valid transport type`);
    let sendQuery = sendDNSQuery[transport];

    return () => sendQuery(
        key,
        domain,
        query,
        nameservers_ipv4
    );
}

/**
 * For each RR type that we have a DNS record for, attempt to send queries over
 * UDP and TCP.
 */
async function sendQueries(nameservers_ipv4) {
    // Add a query for our A record that uses the WebExtensions dns.resolve API as a baseline
    let queries = [];
    queries.push(() => sendDNSQuery.system(APEX_DOMAIN_NAME));

    // Add the remaining queries that use the browser's internal socket APIs
    for (let query of COMMON_QUERIES) {
        queries.push(sendQueryFactory("udp", query, nameservers_ipv4));
        queries.push(sendQueryFactory("tcp", query, nameservers_ipv4));

        // Queries where all clients look up a different domain
        queries.push(sendQueryFactory("udp", query, nameservers_ipv4, true));
        queries.push(sendQueryFactory("tcp", query, nameservers_ipv4, true));
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
    logMessage("Sending telemetry ");
    logMessage(payload);
    payload.measurementID = measurementID;
    browser.telemetry.submitPing(TELEMETRY_TYPE, payload, TELEMETRY_OPTIONS);
}

async function fetchTest() {

    let responseText = null;
    try {
        const response = await fetch(`https://${APEX_DOMAIN_NAME}/`, {cache: "no-store"});
        responseText = await response.text();
    } catch(e) {
        sendTelemetry({reason: STUDY_ERROR_FETCH_FAILED});
        throw new Error(STUDY_ERROR_FETCH_FAILED);
    }
    if (responseText !== EXPECTED_FETCH_RESPONSE) {
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
    let payload = {
        reason: STUDY_MEASUREMENT_COMPLETED,
        measurementID,
        dnsData,
        dnsAttempts,
        hasErrors: dnsQueryErrors.length > 0,
        dnsQueryErrors
    };

    // Run the fetch test one more time before submitting our measurements
    await fetchTest();

    // If we have passed the XHR test a second time, submit our measurements
    sendTelemetry(payload);
}

/**
 * Entry point for our addon.
 */
async function main({uuid = uuidv4()} = {}) {
    measurementID = uuid;

    // Turn on logging only if the add-on was installed temporarily
    loggingEnabled = (await browser.management.getSelf())?.installType === "development"
    logMessage("Logging is enabled");

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

/* Exports */
module.exports = {
    main,
    resetState,
    sendDNSQuery,
    encodeTCPQuery,
    encodeUDPQuery,
    computeKey,
    TELEMETRY_TYPE,
    STUDY_START,
    STUDY_MEASUREMENT_COMPLETED,
    COMMON_QUERIES,
    EXPECTED_FETCH_RESPONSE,
    SMIMEA_HASH,
    APEX_DOMAIN_NAME
};
