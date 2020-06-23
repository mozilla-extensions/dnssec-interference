/* global browser */
const dnsPacket = require("dns-packet");

var query;
var result;

const rollout = {
    async sendQuery(domain) {
        const buf = dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: 'A',
                name: domain
            }]
        });
        query = buf;
        console.log('Query bytes');
        console.log(query);
        console.log('Query decoded');
        console.log(dnsPacket.decode(query));

        await browser.experiments.udpsocket.connect();
        browser.experiments.udpsocket.onDNSResponseReceived.addListener(
            this.processDNSResponse);
        await browser.experiments.udpsocket.sendDNSQuery("8.8.8.8", buf);
    },

    processDNSResponse(responseBytes) {
        Object.setPrototypeOf(responseBytes, query.__proto__);
        console.log('Response bytes')
        console.log(responseBytes);
        console.log('Response decoded');
        console.log(dnsPacket.decode(responseBytes));
    }
}

async function init(domain) {
    await rollout.sendQuery(domain);
}

init('nytimes.com');
