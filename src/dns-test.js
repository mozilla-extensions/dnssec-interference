/* global browser */
const dnsPacket = require("dns-packet");

var query_proto;

const rollout = {
    sendQuery(domain, record_type) {
        const buf = dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: record_type,
                name: domain
            }],
            additionals: [{
                type: 'OPT',
                name: '.',
                udpPayloadSize: 4096,
                flags: dnsPacket.DNSSEC_OK
            }]
        });
        query_proto = buf.__proto__;
        console.log('Query decoded');
        console.log(dnsPacket.decode(buf));

        browser.experiments.udpsocket.onDNSResponseReceived.addListener(
            this.processDNSResponse);
        browser.experiments.udpsocket.sendDNSQuery("8.8.8.8", buf);
    },

    processDNSResponse(responseBytes) {
        Object.setPrototypeOf(responseBytes, query_proto);
        console.log('Response decoded');
        console.log(dnsPacket.decode(responseBytes));
    }
}

async function init() {
    let nameservers = await browser.experiments.resolvconf.readResolvConf();
    console.log(nameservers);
    browser.experiments.udpsocket.openSocket();
    rollout.sendQuery('example.com', 'DNSKEY');
    rollout.sendQuery('example.com', 'RRSIG');
}

init();
