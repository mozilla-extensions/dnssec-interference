/* eslint-env node, mocha */
/* global browser */

const { default: browserMock } = require("webextensions-api-mock");
const {
    main,
    resetState,
    sendDNSQuery,
    TELEMETRY_TYPE,
    STUDY_START,
    STUDY_MEASUREMENT_COMPLETED,
    COMMON_QUERIES
} = require("../src/dns-test");
const { assert } = require("chai");
const sinon = require("sinon");

/**
 * Some fake configuration
 */
const FAKE_NAMESERVERS = ["172.19.134.11", "172.19.134.12"];
const FAKE_DNSQUERY_RESP = [1, 2, 3];
const FAKE_UUID = "fakeuuid";

/**
 * This is a list of all key types we expect to see in the final ping.
 * Each item will have 4 variants: tcp, udp, tcp per-client, udp per-client
 */
const ALL_KEY_TYPES = [
    "SMIMEA",
    "HTTPS",
    "A",
    "A-N",
    "ADO",
    "ACD",
    "ADOCD",
    "DNSKEYDO",
    "RRSIG",
    "NEWONE",
    "NEWTWO",
    "NEWTHREE",
    "NEWFOUR"
].reduce((/** @type string[] */ collector, baseKey) => {
    return [
        ...collector,
        `tcp-${baseKey}`,
        `udp-${baseKey}`,
        `tcp-${baseKey}-U`,
        `udp-${baseKey}-U`,
    ];
}, []);

/**
 * A non-exhaustive list of queries/domains to check to mak sure we're computing
 * and sending the expected key and domain structure.
 */
const EXPECTED_QUERY_CHECK = [
    // A few A records with various flags
    ["tcp", "tcp-A", "dnssec-experiment-moz.net"],
    ["udp", "udp-A", "dnssec-experiment-moz.net"],
    ["tcp", "tcp-ADO", "dnssec-experiment-moz.net"],
    ["udp", "udp-ADOCD", "dnssec-experiment-moz.net"],
    ["tcp", "tcp-A-N-U", `tcp-A-N-U-${FAKE_UUID}.pc.dnssec-experiment-moz.net`],

    // HTTPS records should have a prefix
    ["tcp", "tcp-HTTPS", "httpssvc.dnssec-experiment-moz.net"],
    ["tcp", "tcp-HTTPS-U", `httpssvc.tcp-HTTPS-U-${FAKE_UUID}.pc.dnssec-experiment-moz.net`],
    ["udp", "udp-HTTPS", "httpssvc.dnssec-experiment-moz.net"],
    ["udp", "udp-HTTPS-U", `httpssvc.udp-HTTPS-U-${FAKE_UUID}.pc.dnssec-experiment-moz.net`],
];

/**
 *  It's difficult to import the privileged APIs for the add-on directly,
 *  so we just stub them out.
 */
function setupExperiments(browserObj) {
    const { sinonSandbox } = browserObj;
    browserObj.experiments = {
        resolvconf: {
            readNameserversMac: sinonSandbox.stub(),
            readNameserversWin: sinonSandbox.stub()
        },
        tcpsocket: {
            sendDNSQuery: sinonSandbox.stub()
        },
        udpsocket: {
            sendDNSQuery: sinonSandbox.stub()
        }
    };
}

/**
 * This simulates an environment in which DNS queries can be properly sent
 * and a response is returned.
 */
function setupMeasurementEnvironment(sandbox) {
    browser.telemetry.canUpload.resolves(true);
    browser.captivePortal.getState.resolves("not_captive");
    browser.runtime.getPlatformInfo.resolves({os: "win"});
    browser.experiments.resolvconf.readNameserversWin.resolves(FAKE_NAMESERVERS);
    browser.dns.resolve.resolves({addresses: FAKE_DNSQUERY_RESP})
    browser.experiments.tcpsocket.sendDNSQuery.resolves(Buffer.from(FAKE_DNSQUERY_RESP));
    browser.experiments.udpsocket.sendDNSQuery.resolves(Buffer.from(FAKE_DNSQUERY_RESP));
}

/**
 * @callback customPingMatch
 * @param {{[key: string]: any}} payload The payload sent with the ping
 * @returns {boolean} True if the payload is valid, or else false
 */

/**
 * A helper test function to test whether a telemetry ping was sent with the
 * right parameters.
 *
 * @param {string} reason The reason field included in the ping, e.g. "STUDY_START"
 * @param {customPingMatch=} customMatch Optional function to check other properties in the ping
 */
function assertPingSent(reason, customMatch) {
    sinon.assert.calledWithMatch(
        global.browser.telemetry.submitPing,
        TELEMETRY_TYPE,
        sinon.match((payload => {
            if (payload.reason === reason) {
                if (customMatch) {
                    return customMatch(payload);
                }
                return true;
            }
            return false;
        }))
    );
}

describe("dns-test.js", () => {
    before(async function () {
        global.browser = browserMock();
        setupExperiments(global.browser);
        global.browser.sinonSandbox.spy(sendDNSQuery);
    });

    after(() => {
        delete global.browser;
    });

    beforeEach(async () => {
        browser.sinonSandbox.resetHistory();
        resetState();
        setupMeasurementEnvironment();
        await main({ uuid: FAKE_UUID });
    });
    
    describe("pings", () => {
        it("should send a STUDY_START ping", async () => {
            assertPingSent(STUDY_START);
        });

        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the right number of keys", async () => {
            /**
             * The total number of expected entries is 1 for the system DNS query + 4 queries
             * for each item in the COMMON_QUERY config.
             */
            assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({dnsData, dnsAttempts}) => {
                const expectedCount =  1 + COMMON_QUERIES.length * 4;
                assert.lengthOf(Object.keys(dnsData), expectedCount);
                assert.lengthOf(Object.keys(dnsAttempts), expectedCount);
                return true;
            });
        });

        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the right data", async () => {
            const expectedAttempts = { udpAWebExt: 1 };
            const expectedData = { udpAWebExt: FAKE_DNSQUERY_RESP };

            ALL_KEY_TYPES.forEach(key => {
                expectedAttempts[key] = 1;
                expectedData[key] = FAKE_DNSQUERY_RESP
            });

            assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({dnsAttempts, dnsData}) => {
                assert.deepEqual(
                    dnsAttempts,
                    expectedAttempts,
                    "dnsAttempts should exist and have 1 attempt"
                );
                assert.deepEqual(
                    dnsData,
                    expectedData,
                    "dnsData should exist and have the right response"
                );
                return true;
            });
        });
    });

    describe("queries", () => {
        it("should send the control query", () => {
            sinon.assert.calledOnceWithMatch(sendDNSQuery.system, "dnssec-experiment-moz.net");
        });

        it("should send the expected tcp and udp queries", () => {
            EXPECTED_QUERY_CHECK.forEach(([transport, key, domain]) => {
                sinon.assert.calledWithMatch(sendDNSQuery[transport], key, domain);
            });
        });
    });
});
