/* global browser */

const dnsPacket = require('dns-packet');


function test() {
    const buf = dnsPacket.encode({
        type: 'query',
        id: 1,
        flags: dnsPacket.RECURSION_DESIRED,
        questions: [{
            type: 'A',
            name: 'google.com'
        }],
        additionals: [{
            type: 'OPT',
            name: '.',
            udpPayloadSize: 1024,
            flags: dnsPacket.DNSSEC_OK
        }],
    });
    console.log(buf)
    console.log(dnsPacket.decode(buf));
};


test();
