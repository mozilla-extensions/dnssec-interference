/* eslint-env node, mocha */

const { default: browserMock } = require("webextensions-api-mock");

const { assert } = require("chai");

describe("DNSTest", () => {
    before(function () {
        global.browser = browserMock();
    });
    after(function () {
        delete global.browser;
    });
    beforeEach(function () {
        browser.sinonSandbox.resetHistory();
    });

    it("should mock the global browser APIs", () => {
        browser.telemetry.submitPing("dnssec-study-v1", "foo", { addClientId: true, addEnvironment: true });
        assert.isTrue(global.browser.telemetry.submitPing.calledOnce);
    });
});
