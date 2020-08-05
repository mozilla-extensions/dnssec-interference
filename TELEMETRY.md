## Usual Firefox Telemetry is mostly unaffected

- No change: `main` and other pings are UNAFFECTED by this add-on.
- Respects telemetry preferences. If a client has disabled telemetry, no telemetry 
will be sent for that client.

## Study-specific endings

This study has no study-specific endings.

## Choice of telemetry API

- We will use the [browser.telemetry.submitPing()](https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/collection/webextension-api.html) API to submit custom pings
  for our study.

## Custom pings, specific to THIS study.

- This add-on opens UDP and TCP sockets at browser startup and sends DNS requests for a 
domain name that we control. We request seven different resource record types, 
re-transmitting if necessary: 

  - A
  - RRSIG
  - DNSKEY
  - SMIMEA
  - HTTPS
  - NEWONE (a custom resource record type that we created for this study)
  - NEWTWO (an additional custom resource record type that we created for this study)

We wait for the DNS 
responses and then encapsulate the raw bytes into a ping, excluding any IP or UDP headers. For each 
record type, we also record how many transmissions were sent. An example ping
containing the DNS responses takes the following form:

```
event: "dnsResponses"
measurement_id: ...
A_udp_data: ...
A_tcp_data: ...
A_udp_transmission: "1",
A_tcp_transmission: "1",
RRSIG_udp_data: ...
RRSIG_tcp_data: ...
RRSIG_udp_transmission: "2",
RRSIG_tcp_transmission: "1",
DNSKEY_udp_data: ...
DNSKEY_tcp_data: ...
DNSKEY_udp_transmission: "1",
DNSKEY_tcp_transmission: "1",
SMIMEA_udp_data: ...
SMIMEA_tcp_data: ...
SMIMEA_udp_transmission: "3",
SMIMEA_tcp_transmission: "1",
HTTPS_udp_data: ...
HTTPS_tcp_data: ...
HTTPS_udp_transmission: "1",
HTTPS_tcp_transmission: "1",
NEWONE_udp_data: ...
NEWONE_tcp_data: ...
NEWONE_udp_transmission: "1",
NEWONE_tcp_transmission: "1",
NEWTWO_udp_data: ...
NEWTWO_tcp_data: ...
NEWTWO_udp_transmission: "1"
NEWTWO_tcp_transmission: "1"
```

- We also send a ping at browser startup that simply indicates the beginning of 
the experiment for a given browser session. Similarly, we send another ping 
after the DNS response ping has been sent to indicate the end of the experiment 
for a given browser session. These pings take the following form:

```
event: (measurementStart, measurementEnd),
measurement_id: ...
```

- Lastly, we send a ping if any error occurs, i.e. if UDP sockets failed to 
open, no nameservers could be read from disk, or if a DNS request could not be 
sent. Each error has its own ping. The error pings take the following form:

```
event: (readNameserversError, noNameserversError, noIPv4NameserversError,
openSocketError, sendQueryError),
measurement_id: ...
```

- In all of the pings, `measurement_id` is a UUID that is added to represent a
  particular instance of our measurements for a given client. In essence, it is 
  a session ID, since our measurements should only run once at browser startup,
  barring some code error.

# Performance optimizations affecting submitted telemetry

- Instead of sending a separate ping for each DNS response, we wait for all of 
the DNS responses to return, re-transmitting lost packets if necessary. We then 
encapsulate the DNS responses into a single ping.
- If we receive the correct responses for each DNS request, then the size of the
data for the ping containing the responses should be at most 3 KB.
- As previously noted, we only run the measurements once per browser startup.
