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
    SMIMEA_HASH,
    APEX_DOMAIN_NAME
} = require("../src/dns-test");
const chai = require("chai")
const { assert } = chai;
const sinon = require("sinon");
const { v4: uuidv4 } = require("uuid");

// Validate according to the data pipeline schema
// https://github.com/mozilla-services/mozilla-pipeline-schemas/blob/main/schemas/telemetry/dnssec-study-v1/dnssec-study-v1.4.schema.json
const Ajv = require("ajv");
const ajv = new Ajv();
const pingSchema = require("./dnssec-v1.schema.json");
const payloadSchema = {
    definitions: pingSchema.definitions,
    properties: {
        payload: pingSchema.properties.payload
    }
};

function validatePayload(payload) {
    const validate = ajv.compile(payloadSchema);
    const valid = validate({payload});
    assert.isOk(valid, "not a valid payload:\n" + JSON.stringify(validate.errors, null, 2));
}

// < Node 18
global.fetch = global.fetch || require("node-fetch");

/**
 * Some fake configuration
 */
const FAKE_NAMESERVERS = ["172.19.134.11", "172.19.134.12"];
const FAKE_WEBEXT_RESP = ["34.120.4.181"];
const FAKE_DNSQUERY_RESP = [1, 2, 3];
const FAKE_UUID = uuidv4();
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
        `udp-${baseKey}-U`
    ];
}, []);

/**
 * A non-exhaustive list of queries/domains to check to mak sure we're computing
 * and sending the expected key and domain structure.
 */
const EXPECTED_QUERY_CHECK = [
    // A few A records with various flags
    ["tcp", "tcp-A", APEX_DOMAIN_NAME],
    ["udp", "udp-A", APEX_DOMAIN_NAME],
    ["tcp", "tcp-ADO", APEX_DOMAIN_NAME],
    ["udp", "udp-ADOCD", APEX_DOMAIN_NAME],
    ["tcp", "tcp-A-N-U", `tcp-A-N-U-${FAKE_UUID}.pc.${APEX_DOMAIN_NAME}`],

    // HTTPS records should have a prefix
    ["tcp", "tcp-HTTPS", "httpssvc." + APEX_DOMAIN_NAME],
    ["tcp", "tcp-HTTPS-U", `tcp-HTTPS-U-${FAKE_UUID}.httpssvc-pc.${APEX_DOMAIN_NAME}`],
    ["udp", "udp-HTTPS", "httpssvc." + APEX_DOMAIN_NAME],
    ["udp", "udp-HTTPS-U", `udp-HTTPS-U-${FAKE_UUID}.httpssvc-pc.${APEX_DOMAIN_NAME}`],

    // SMIMEA records should have the right SMIMEA structure
    ["tcp", "tcp-SMIMEA", SMIMEA_HASH + "._smimecert." + APEX_DOMAIN_NAME],
    ["udp", "udp-SMIMEA-U", `udp-SMIMEA-U-${FAKE_UUID}._smimecert.pc.${APEX_DOMAIN_NAME}`],
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

    mockFetch(`https://${APEX_DOMAIN_NAME}/`, EXPECTED_FETCH_RESPONSE);

    browser.experiments.resolvconf.readNameserversWin.resolves(FAKE_NAMESERVERS);
    browser.dns.resolve.resolves({addresses: FAKE_WEBEXT_RESP})
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
                    validatePayload(payload);
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
            assert.equal(computeKey("udp", {rrtype: "A", dnssec_ok: true}), "udp-ADO");
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

        it("should send a valid STUDY_MEASUREMENT_COMPLETED ping with the right number of keys", async () => {
            await run();
            /**
             * The total number of expected entries 2 queries for each item in the COMMON_QUERY config,
             * and 1 extra (for the webExtA) in non-per-client data
             */
            assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({
                dnsData,
                dnsAttempts,
            }) => {
                assert.lengthOf(Object.keys(dnsData),  1 + COMMON_QUERIES.length * 4);
                assert.lengthOf(Object.keys(dnsAttempts),  1 + COMMON_QUERIES.length * 4);
                return true;
            });
        });

        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the right data", async () => {
            await run();
            const expected = {
                reason: STUDY_MEASUREMENT_COMPLETED,
                measurementID: FAKE_UUID,
                dnsAttempts: { udpAWebExt: 1 },
                dnsData: { udpAWebExt: FAKE_WEBEXT_RESP },
                dnsQueryErrors: [],
                hasErrors: false
            };

            ALL_KEY_TYPES.forEach(key => {
                expected.dnsAttempts[key] = 1;
                expected.dnsData[key] = FAKE_DNSQUERY_RESP;
            });

            assertPingSent(STUDY_MEASUREMENT_COMPLETED, (payload) => {
                assert.deepEqual(
                    payload,
                    expected,
                    "should have all the expected data"
                );
                return true;
            });
        });
        it("should send a STUDY_MEASUREMENT_COMPLETED ping with the correct data when tcp reattempts were made", async () => {
            const expectedAttempts = { udpAWebExt: 1 };
            const expectedData = { udpAWebExt: FAKE_WEBEXT_RESP };

            // Ensure tcpsocket fails only for the first nameserver
            browser.experiments.tcpsocket.sendDNSQuery.withArgs(FAKE_NAMESERVERS[0]).throws();

            await run();

            ALL_KEY_TYPES.forEach(key => {
                expectedAttempts[key] = key.match(/^tcp/) ? 2 : 1
                expectedData[key] = FAKE_DNSQUERY_RESP
            });

            assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({dnsAttempts, dnsData, dnsQueryErrors}) => {
                assert.deepEqual(
                    dnsAttempts,
                    expectedAttempts,
                    "dnsAttempts should exist and have 1 attempt"
                );
                assert.includeDeepMembers(
                    dnsQueryErrors,
                    [
                        {
                            reason: 'STUDY_ERROR_TCP_MISC',
                            errorRRTYPE: 'tcp-DNSKEYDO-U',
                            errorAttempt: 1
                        },
                        {
                            reason: 'STUDY_ERROR_TCP_MISC',
                            errorRRTYPE: 'tcp-A',
                            errorAttempt: 1
                      }
                    ],
                    "errors were logged"
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
            browser.experiments.udpsocket.sendDNSQuery.withArgs(APEX_DOMAIN_NAME).throws();
            browser.experiments.tcpsocket.sendDNSQuery.withArgs(APEX_DOMAIN_NAME).throws();

            await run();

            assertPingSent(STUDY_MEASUREMENT_COMPLETED);
        });
    });

    describe("queries", () => {
        it("should send the control query", async () => {
            await run();
            sinon.assert.calledOnceWithMatch(sendDNSQuery.system, APEX_DOMAIN_NAME);
        });

        it("should send the expected tcp and udp queries", async () => {
            await run();
            EXPECTED_QUERY_CHECK.forEach(([transport, ...args]) => {
                sinon.assert.calledWithMatch(sendDNSQuery[transport], ...args);
            });
        });
    });
});
