/* eslint-env node, mocha */
/* global browser */

const { default: browserMock } = require("webextensions-api-mock");
const { main } = require("../src/dns-test");
const { assert } = require("chai");

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

function setupMeasurementEnvironment(sandbox) {
    browser.telemetry.canUpload.resolves(true);
    browser.captivePortal.getState.resolves("not_captive");
    browser.runtime.getPlatformInfo.resolves({os: "win"});
    browser.experiments.resolvconf.readNameserversWin.resolves([ "172.19.134.11" ]);
}

describe("DNSTest", () => {
    before(async function () {
        global.browser = browserMock();
        setupExperiments(global.browser);
    });

    after(function () {
        delete global.browser;
    });

    beforeEach(function () {
        browser.sinonSandbox.resetHistory();
        setupMeasurementEnvironment();
    });

    it("should properly mock the webextension APIs", () => {
        browser.telemetry.submitPing("dnssec-study-v1", "foo", { addClientId: true, addEnvironment: true });
        assert.isTrue(browser.telemetry.submitPing.calledOnce);
    });

    it("should call main", async () => {
        await main();
    });
});
