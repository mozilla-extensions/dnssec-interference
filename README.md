This repository contains code for a privileged Firefox addon that measures
rates of DNSSEC interference by network middleboxes. It does so by inducing 
Firefox clients to issue DNS requests for domain names that Mozilla controls. 
The DNS responses (or lack thereof) are then sent to Mozilla's telemetry 
servers for analysis.

The entry point for the 
addon is `src/dns-test.js`, which is converted into a script named 
`src/background.js` at addon build time through [browserify](https://browserify.org/).
This enables us to bundle Node.js dependencies with our addon code.

The experimental APIs 
that are necessary for opening UDP/TCP sockets and reading which nameservers a 
client is using are located in `src/experiments`. The addon also uses a [modified
form](https://github.com/mozilla/dns-packet) of the [dns-packet](https://github.com/mafintosh/dns-packet) Node.js module, 
which enables us to send queries for SMIMEA records, HTTPS records, and two new 
record types we created that are not standardized.

## Problem Description 
DNSSEC provides powerful cryptographic guarantees, but in practice its security benefits are unclear. [Previous work](https://www.usenix.org/system/files/conference/usenixsecurity13/sec13-paper_lian.pdf) has shown that DNSSEC has not been implemented by most recursive resolvers, leaving many clients susceptible to cache poisoning attacks. Furthermore, a non-negligible population of recursive resolvers that support DNSSEC fail to correctly perform validation. Validation could instead be performed by web browsers, but it is unclear whether clients would gain significant security benefits. For example, if network middleboxes between clients and recursive resolvers drop DNSSEC records, then web browsers will not be able to perform validation. 

## Measurement Description
To understand the extent to which network middleboxes between clients and recursive resolvers interfere with DNSSEC validation, we will perform a large-scale measurement with Firefox desktop clients. There are three questions we want to answer:

- At what rate do network middleboxes between clients and recursive resolvers interfere with DNSSEC records (i.e. DNSKEY and RRSIG)?
- How does the rate of DNSSEC interference compare to interference with other relatively new record types, such as SMIMEA and HTTPS?
- Are there certain populations of clients or networks for which interference occurs more often?

At a high-level, we will first serve the above record types from domain names in a zone that we control (e.g., `*.dnssec-experiment-moz.net`). We will then induce Firefox clients to request the following record types from domain names in our zone over UDP and TCP:

- A
- A (w/ DO=0, CD=1)
- A (w/ DO=1, CD=0)
- A (w/ DO=1, CD=1)
- RRSIG
- DNSKEY
- SMIMEA
- HTTPS
- NEWONE (a non-standard record type that we created)
- NEWTWO (another non-standard record type that we created)
- NEWTHREE (another non-standard record type that we created)
- NEWFOUR (another non-standard record type that we created)

For UDP queries, we follow the default re-transmission behavior specified in [/etc/resolv.conf for Linux](https://www.man7.org/linux/man-pages/man5/resolv.conf.5.html). For TCP queries, we query nameservers in order of appearance and let TCP handle re-transmissions. Finally, we will check whether we got the expected responses (or any response at all). To run this study, we will deploy a privileged addon to a sample of Firefox desktop clients. Clients that have opted out of telemetry or participating in studies will not receive the addon.

This data should inform whether it is worth implementing DNSSEC validation in Firefox.
If DNSSEC records are frequently dropped by network middleboxes, then Firefox clients may not get much benefit from attempting to validate DNSSEC in the first place. It may also inform whether it is viable to use new record types-such as [HTTPS](https://datatracker.ietf.org/doc/draft-ietf-dnsop-svcb-https/)--to implement DNS-over-HTTPS resolver discovery. If HTTPS records are frequently dropped by network middleboxes, then clients can not reliably discover local DoH resolvers.

## Libraries
Our addon utilizes the following Node.js modules:

- [browserify](https://github.com/browserify/browserify)
- [npm-run-all](https://github.com/mysticatea/npm-run-all)
- [uuid](https://github.com/uuidjs/uuid)
- [web-ext](https://github.com/mozilla/web-ext)
- [ahounsel/dns-packet](https://github.com/ahounsel/dns-packet)

## Privacy Considerations
To analyze the rate of network middlebox interference with DNSSEC records, we will [send DNS responses](https://github.com/mozilla-extensions/dnssec-interference/blob/master/TELEMETRY.md) to our telemetry system, rather than performing any analysis locally within the client’s browser. This would enable us to see the different ways that DNS responses are interfered with without relying on whatever analysis logic we bake into our study addon.

We recognize that we may be raising serious privacy concerns by collecting DNS responses. However, as previously mentioned, these are responses for domain names in a zone that we control---not for any other domain names that a client issues requests for when browsing the web. Furthermore, we are not collecting UDP or IP headers. We are only collecting the payload of the DNS response, for which we know the expected format. The data we are interested in should not include identifying information about a client, unless middleboxes inject such information when they interfere with DNS requests/responses. Lastly, we do not send the nameservers that a client uses to our telemetry system.

As part of our analysis, we also collect technical data about the client's
environment, such as browser version, operating system, and active addons.
