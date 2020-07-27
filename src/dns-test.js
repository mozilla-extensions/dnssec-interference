/* global browser */
const dnsPacket = require("dns-packet-fork");

const rrtypes = ['A', 'AAAA', 'RRSIG', 'DNSKEY', 'SMIMEA', 'HTTPS', 'NEW'];
const resolvconf_timeout = 5000; // 5 seconds
const resolvconf_attempts = 2;

var nameservers = [];
var dns_responses = {};
var query_proto;

const rollout = {
    async sendQuery(domain, nameservers, rrtype, useIPv4) {
        let written = 0;
        const buf = dnsPacket.encode({
            type: 'query',
            id: 1,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [{
                type: rrtype,
                name: domain
            }],
            additionals: [{
                type: 'OPT',
                name: '.',
                udpPayloadSize: 4096
            }]
        });
        query_proto = buf.__proto__;
        console.log('Query decoded');
        console.log(dnsPacket.decode(buf));

        // Keep re-transmitting according to default resolv.conf behavior,
        // checking if we have a DNS response for the RR type yet
        for (let i = 0; i < nameservers.length; i++) {
            for (let j = 0; j < resolvconf_attempts; j++) {
                let nameserver = nameservers[i];
                let written = await browser.experiments.udpsocket.sendDNSQuery(nameserver, buf, rrtype, useIPv4);
                await sleep(resolvconf_timeout);

                if (!isUndefined(dns_responses[rrtype])) {
                    break;
                } else {
                    console.log("Need to re-transmit");
                }
            }
            return written;
        }
    },

    processDNSResponse(responseBytes, rrtype, usedIPv4) {
        /* 
         * TODO: Replace first argument with the bytes that we care about
         * TODO: Determine if the bucket should be "event" or "main", rather 
         * than "dnssec-experiment"
         */
        dns_responses[rrtype] = responseBytes;
        // sendResponsePing([123], rrtype, usedIPv4);
        console.log(responseBytes, rrtype, (usedIPv4 = true ? "IPv4" : "IPv4"));

        Object.setPrototypeOf(responseBytes, query_proto);
        decodedResponse = dnsPacket.decode(responseBytes);
        console.log('Response decoded');
        console.log(decodedResponse);
    }
}

function sendNameserversErrorPing() {
    // Test ping
    const bucket = "dnssec-experiment";
    const options = {addClientId: true, addEnvironment: true};
    const payload = {
      type: "dnssec-experimnent",
      msg: "error-no-nameservers",
      testing: true
    };
    browser.telemetry.submitPing(bucket, payload, options);
}

function sendSocketsOpenErrorPing(_usedIPv4) {
    // Test ping
    const bucket = "dnssec-experiment";
    const options = {addClientId: true, addEnvironment: true};
    const payload = {
      type: "dnssec-experimnent",
      msg: "error-socket-not-opened",
      usedIPv4: _usedIPv4,
      testing: true
    };
    browser.telemetry.submitPing(bucket, payload, options);
}

function sendBytesWrittenErrorPing(_bytesWritten, _rrtype, _usedIPv4) {
    // Test ping
    const bucket = "dnssec-experiment";
    const options = {addClientId: true, addEnvironment: true};
    const payload = {
      type: "dnssec-experimnent",
      msg: "error-bytes-written",
      bytesWritten: _bytesWritten,
      rrtype: _rrtype,
      usedIPv4: _usedIPv4,
      testing: true
    };
    browser.telemetry.submitPing(bucket, payload, options);
}

function sendResponsePing(_responseBytes, _rrtype, _usedIPv4) {
    // Test ping
    const bucket = "dnssec-experiment";
    const options = {addClientId: true, addEnvironment: true};
    const payload = {
      type: "dnssec-experiment",
      msg: "dns-response",
      responseBytes: _responseBytes,
      rrtype: _rrtype,
      usedIPv4: _usedIPv4,
      testing: true
    };
    browser.telemetry.submitPing(bucket, payload, options);
}

async function init() {
    nameservers = await browser.experiments.resolvconf.readNameserversMac();
    // nameservers = await browser.experiments.resolvconf.readNameserversWin();

    if (!Array.isArray(nameservers) || nameservers.length == 0) {
        sendNameserversErrorPing();
        return;
    }
  
    let nameservers_ipv4 = [];
    let nameservers_ipv6 = [];
    for (var i = 0; i < nameservers.length; i++) {
        let ns = nameservers[i];
        if (!isUndefined(ns) && ns.includes(".")) {
            nameservers_ipv4.push(ns);
        } else if (!isUndefined(ns) && ns.includes(":")) {
            nameservers_ipv6.push(ns);
        }
    }
    console.log("IPv4 resolvers: ", nameservers_ipv4);
    console.log("IPv6 resolvers: ", nameservers_ipv6);

    // TODO: If we use IPv4 and IPv6 sockets in the future, then we may 
    // want to split openSocket() into two different methods. This would enable 
    // us to determine if IPV4 sockets vs. IPv6 sockets failed to open.
    let allOpened = await browser.experiments.udpsocket.openSocket();
    if (!allOpened) {
        // Since we're just using IPv4 sockets right now, hard-code to "true."
        sendSocketsOpenErrorPing(true);
        return;
    }
    browser.experiments.udpsocket.onDNSResponseReceived.addListener(rollout.processDNSResponse);

    if (nameservers_ipv4.length > 0) {
        let written;
        for (let i = 0; i < rrtypes.length; i++) {
          let rrtype = rrtypes[i];
          if (rrtype == 'HTTPS') {
            written = await rollout.sendQuery('cloudflare-http1.com', nameservers_ipv4, rrtype, true);
          } else {
            written = await rollout.sendQuery('example.com', nameservers_ipv4, rrtype, true);
          }

          if (written <= 0) {
            sendBytesWrittenErrorPing(written, rrtype, true);
          }
        }
    }
    console.log(dns_responses);
}

function isUndefined(x) {
   return (typeof(x) === 'undefined' || x === null);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

init();
