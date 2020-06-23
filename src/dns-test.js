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
        console.log(dnsPacket.decode(buf));

        await browser.experiments.udpsocket.connect();
        browser.experiments.udpsocket.onSomething.addListener(this.test2);
        await browser.experiments.udpsocket.send("8.8.8.8", buf);
    },

    test2(param1) {
        console.log(param1);
    }
}

rollout.test();

