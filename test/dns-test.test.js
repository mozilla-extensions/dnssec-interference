/* eslint-env node, mocha */
/* global browser */


/**
 * @typedef {import("../src/dns-test.js").QueryConfig} QueryConfig
 */

const { default: browserMock } = require("webextensions-api-mock");
const {
    main,
    resetState,
    computeKey,
    sendDNSQuery,
    TELEMETRY_TYPE,
    STUDY_START,
    STUDY_MEASUREMENT_COMPLETED,
    COMMON_QUERIES,
    EXPECTED_FETCH_RESPONSE,
    SMIMEA_HASH
} = require("../src/dns-test");
const chai = require("chai")
const { assert } = chai;
const sinon = require("sinon");

// Validate according to the data pipeline schema
// https://github.com/mozilla-services/mozilla-pipeline-schemas/blob/main/schemas/telemetry/dnssec-study-v1/dnssec-study-v1.4.schema.json
chai.use(require("chai-json-schema-ajv"));
const pingSchema = require("./dnssec-v1.schema.json");
const payloadSchema = {
    definitions: pingSchema.definitions,
    properties: {payload: pingSchema.properties.payload}
};

// < Node 18
global.fetch = global.fetch || require("node-fetch");

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
    "DS",
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
    ["tcp", "tcp-HTTPS-U", `tcp-HTTPS-U-${FAKE_UUID}.httpssvc-pc.dnssec-experiment-moz.net`],
    ["udp", "udp-HTTPS", "httpssvc.dnssec-experiment-moz.net"],
    ["udp", "udp-HTTPS-U", `udp-HTTPS-U-${FAKE_UUID}.httpssvc-pc.dnssec-experiment-moz.net`],

    // SMIMEA records should have the right SMIMEA structure
    ["tcp", "tcp-SMIMEA", SMIMEA_HASH + "._smimecert.dnssec-experiment-moz.net"],
    ["udp", "udp-SMIMEA-U", `udp-SMIMEA-U-${FAKE_UUID}._smimecert.pc.dnssec-experiment-moz.net`],
];

function mockFetch(url, text) {
    global.fetch.withArgs(url).resolves(Promise.resolve({text: () => Promise.resolve(text)}));
}

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
async function setupMeasurementEnvironment(sandbox) {
    browser.telemetry.canUpload.resolves(true);
    browser.captivePortal.getState.resolves("not_captive");
    browser.runtime.getPlatformInfo.resolves({os: "win"});

    mockFetch("https://dnssec-experiment-moz.net/", EXPECTED_FETCH_RESPONSE);

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
                    assert.jsonSchema(payload, payloadSchema);
                    return customMatch(payload);
                }
                return true;
            }
            return false;
        }))
    );
}

function run() {
    return main({ uuid: FAKE_UUID });
}

describe("dns-test.js", () => {
    before(async function () {
        global.browser = browserMock();
        setupExperiments(global.browser);
        global.browser.sinonSandbox.stub(global, "fetch");
        global.browser.sinonSandbox.spy(sendDNSQuery);
    });

    after(() => {
        delete global.browser;
    });

    beforeEach(async () => {
        browser.sinonSandbox.resetHistory();
        resetState();
        setupMeasurementEnvironment();
    });

    describe("computeKey", () => {
        it("should compute a key for a record", () => {
            assert.equal(computeKey("tcp", {rrtype: "A"}), "tcp-A");
        });
        it("should compute a key for a per-client record", () => {
            assert.equal(computeKey("tcp", {rrtype: "A"}, true), "tcp-A-U");
        });
        it("should compute a key for a DO record", () => {
            assert.equal(computeKey("udp", {rrtype: "DNSKEY", dnssec_ok: true}), "udp-DNSKEYDO");
        });
        it("should compute a key for a CD record", () => {
            assert.equal(computeKey("udp", {rrtype: "A", checking_disabled: true}), "udp-ACD");
        });
        it("should compute a key for a noedns0 + per-client record", () => {
            assert.equal(computeKey("udp", {rrtype: "A", noedns0: true}, true), "udp-A-N-U");
        });
    });

    describe("pings", () => {
        it("should send a STUDY_START ping", async () => {
            await run();
            assertPingSent(STUDY_START);
        });

        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the right number of keys", async () => {
            await run();
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
            await run();
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
        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the correct data when tcp reattempts were made", async () => {
            const expectedAttempts = { udpAWebExt: 1 };
            const expectedData = { udpAWebExt: FAKE_DNSQUERY_RESP };

            // Ensure tcpsocket fails only for the first nameserver
            browser.experiments.tcpsocket.sendDNSQuery.withArgs(FAKE_NAMESERVERS[0]).throws();

            await run();

            ALL_KEY_TYPES.forEach(key => {
                expectedAttempts[key] = key.match(/^tcp/) ? 2 : 1
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

        it("should send STUDY_MEASUREMENT_COMPLETED even when some queries fail", async () => {
            browser.experiments.udpsocket.sendDNSQuery.withArgs("dnssec-experiment-moz.net").throws();
            browser.experiments.tcpsocket.sendDNSQuery.withArgs("dnssec-experiment-moz.net").throws();

            await run();

            assertPingSent(STUDY_MEASUREMENT_COMPLETED);
        });
    });

    describe("queries", () => {
        it("should send the control query", async () => {
            await run();
            sinon.assert.calledOnceWithMatch(sendDNSQuery.system, "dnssec-experiment-moz.net");
        });

        it("should send the expected tcp and udp queries", async () => {
            await run();
            EXPECTED_QUERY_CHECK.forEach(([transport, ...args]) => {
                sinon.assert.calledWithMatch(sendDNSQuery[transport], ...args);
            });
        });
    });
});
