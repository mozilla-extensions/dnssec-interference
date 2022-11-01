/* eslint-env node, mocha */
/* global browser */

const { default: browserMock } = require("webextensions-api-mock");
const {
    main,
    resetState,
    TELEMETRY_TYPE,
    STUDY_START,
    STUDY_MEASUREMENT_COMPLETED,
    COMMON_QUERIES
} = require("../src/dns-test");
const { assert } = require("chai");
const sinon = require("sinon");

const FAKE_DNSQUERY_RESP = [1, 2, 3];

/**
 *  It's difficult to import the privileged APIs directly so we
 *  just stub them out.
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
    browser.experiments.resolvconf.readNameserversWin.resolves([ "172.19.134.11" ]);
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
    });

    after(() => {
        delete global.browser;
    });

    beforeEach(async () => {
        browser.sinonSandbox.resetHistory();
        resetState();
        setupMeasurementEnvironment();
        await main();
    });

    it("should send a STUDY_START ping", async () => {
        assertPingSent(STUDY_START);
    });

    it("should send a STUDY_MEASUREMENT_COMPLETED ping with the right number of entries", async () => {
        /**
         * The total number of expected entries is 1 for the system DNS query + 4 queries
         * for each item in the COMMON_QUERY config.
         *
         * For example, for an "A" record entry:
         *     1. One TCP query for dnssec-experiment-moz.net
         *     2. One UDP query for dnssec-experiment-moz.net
         *     3. One TCP query for sdf98798s.pc.dnssec-experiment-moz.net
         *     4. One UDP query for sdf98798s.pc.dnssec-experiment-moz.net
         */
        assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({dnsData}) => {
            assert.lengthOf(Object.keys(dnsData), 1 + COMMON_QUERIES.length * 4);
            return true;
        });
    });

    it("should send a STUDY_MEASUREMENT_COMPLETED ping with all query attempts and responses", async () => {
        const expectedAttempts = { udpAWebExt: 1 };
        const expectedData = { udpAWebExt: FAKE_DNSQUERY_RESP };
        [
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

        ].forEach(record => {
            expectedAttempts["tcp-" + record] = 1;
            expectedAttempts["udp-" + record] = 1;
            expectedAttempts["tcp-" + record + "-U"] = 1;
            expectedAttempts["udp-" + record + "-U"] = 1;

            expectedData["tcp-" + record] = FAKE_DNSQUERY_RESP
            expectedData["udp-" + record] = FAKE_DNSQUERY_RESP
            expectedData["tcp-" + record + "-U"] = FAKE_DNSQUERY_RESP
            expectedData["udp-" + record + "-U"] = FAKE_DNSQUERY_RESP
        });

        assertPingSent(STUDY_MEASUREMENT_COMPLETED, ({dnsAttempts, dnsData}) => {
            assert.deepEqual(dnsAttempts, expectedAttempts, "dnsAttempts should exist and have 1 attempt");
            assert.deepEqual(dnsData, expectedData, "dnsData should exist and have the right response")
            return true;
        });

    });
});
