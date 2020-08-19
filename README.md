## Problem Description 
DNSSEC provides powerful cryptographic guarantees, but in practice its security benefits are unclear. [Previous work](https://www.usenix.org/system/files/conference/usenixsecurity13/sec13-paper_lian.pdf) has shown that DNSSEC has not been implemented by most recursive resolvers, leaving many clients susceptible to cache poisoning attacks. Furthermore, a non-negligible population of recursive resolvers that support DNSSEC fail to correctly perform validation. Validation could instead be performed by web browsers, but it is unclear whether clients would gain significant security benefits. For example, if network middleboxes between clients and recursive resolvers drop DNSSEC records, then web browsers will not be able to perform validation. 

## Measurement Description
To understand the extent to which network middleboxes between clients and recursive resolvers interfere with DNSSEC validation, we will perform a large-scale measurement with Firefox desktop clients. There are three questions we want to answer:

- At what rate do network middleboxes between clients and recursive resolvers interfere with DNSSEC records (i.e. DNSKEY and RRSIG)?
- How does the rate of DNSSEC interference compare to interference with other relatively new record types, such as SMIMEA and HTTPS?
- Are there certain populations of clients or networks for which interference occurs more often?

At a high-level, we will first serve the above record types from domain names in a zone that we control (\*dnssec-experiment-moz.net). We will then induce Firefox clients to request the following record types from domain names in our zone:

- A
- RRSIG
- DNSKEY
- SMIMEA
- HTTPS
- NEWONE (a new record type that is not standardized)
- NEWTWO (another new record type that is not standardized)

Finally, we will check whether we got the expected responses (or any response at all). To run this study, we will deploy a Mozilla addon to Firefox desktop clients. Users that have opted out of telemetry or participating in studies will not receive the addon.

This data should inform whether it is worth implementing DNSSEC validation in Firefox.
If DNSSEC records are frequently dropped by network middleboxes, then Firefox clients may not get much benefit from attempting to validate DNSSEC in the first place. It may also inform whether it is viable to use new record types-such as HTTPS--to implement DNS-over-HTTPS resolver discovery. If HTTPS records are frequently dropped by network middleboxes, then clients can not reliably discover local DoH resolvers.

# Ethics Considerations
To analyze the rate of network middlebox interference with DNSSEC records, we will send DNS responses to our telemetry system, rather than performing any analysis locally within the client’s browser. This would enable us to see the different ways that DNS responses are interfered with without relying on whatever analysis logic we bake into our study addon. We recognize that we may be raising serious privacy concerns by collecting DNS responses. However, as previously mentioned, these are responses for a domain name that we control---not for any other domain names that a client issues requests for when browsing the web. Furthermore, we are not collecting UDP or IP headers. We are only collecting the payload of the DNS response, for which we know the expected format. The data we are interested in should not include identifying information about a client, unless middleboxes inject such information when they interfere with DNS requests/responses.
