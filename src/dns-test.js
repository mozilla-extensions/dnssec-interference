/* global browser */
const dnsPacket = require("dns-packet");

const rollout = {
    async test() {
        const buf = dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: 'A',
                name: 'google.com'
            }]
        });
        console.log(buf)

        await browser.experiments.udpsocket.connect(buf);
    }
}

rollout.test();
