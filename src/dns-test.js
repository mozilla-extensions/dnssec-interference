/* exported test */

const dnsPacket = require('dns-packet');

function test() {
    const buf = dnsPacket.encode({
        type: 'query',
        id: 1,
        flags: dnsPacket.RECURSION_DESIRED,
        questions: [{
            type: 'A',
            name: 'google.com'
        }]
    });
    console.log(buf);
    console.log(dnsPacket.decode(buf));
};

test();
