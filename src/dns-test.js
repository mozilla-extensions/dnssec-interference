/* global browser */
const dnsPacket = require("dns-packet");

var query_proto;

const rollout = {
    sendQuery(domain, nameserver, record_type) {
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
        browser.experiments.udpsocket.sendDNSQuery(nameserver, buf);
    },

    processDNSResponse(responseBytes) {
        Object.setPrototypeOf(responseBytes, query_proto);
        console.log('Response decoded');
        console.log(dnsPacket.decode(responseBytes));
    }
}

async function init() {
    let nameservers = await browser.experiments.resolvconf.readResolvConf();
    if (!Array.isArray(nameservers) || nameservers.length == 0) {
        throw "Could not read /etc/resolv.conf, or nameservers not found in file";
    }
    
    let ns = nameservers[0];
    let useIPv6 = false;
    if (ns.includes(":")) {
        useIPv6 = true; 
    }
    console.log("Nameserver chosen: " + ns);
    browser.experiments.udpsocket.openSocket(useIPv6);

    rollout.sendQuery('example.com', ns, 'A');
    rollout.sendQuery('example.com', ns, 'DNSKEY');
    rollout.sendQuery('example.com', ns, 'RRSIG');
}

init();
