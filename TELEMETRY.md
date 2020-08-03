## Usual Firefox Telemetry is mostly unaffected

- No change: `main` and other pings are UNAFFECTED by this add-on, except that 
[shield-studies-addon-utils](https://github.com/mozilla/shield-studies-addon-utils)
adds the add-on id as an active experiment in the telemetry environment.
- Respects telemetry preferences. If a client has disabled telemetry, no telemetry 
will be sent for that client.

## Study-specific endings

This study has no study-specific endings.

## `shield-study` pings (common to all shield-studies)

[shield-studies-addon-utils](https://github.com/mozilla/shield-studies-addon-utils)
sends the usual packets.

## `shield-study-addon` pings, specific to THIS study.

- This add-on opens UDP sockets at browser startup and sends DNS requests for a 
domain name that we control. We request seven different resource record types, 
re-transmitting if necessary. We wait for the DNS 
responses and then encapsulate the raw bytes into a ping, excluding any IP or UDP headers. For each 
record type, we also record how many transmissions were necessary to receive a
response. An example ping
containing the DNS responses looks like this, where each keyword before `_data`
and `_transmission` corresponds to a DNS resource record type:

```
event: "dnsResponses"
measurement_id: <UUID string goes here>
A_data: <Uint8Array converted to a string>,
A_transmission: "1",
RRSIG_data: <Uint8Array converted to a string>,
RRSIG_transmission: "1",
DNSKEY_data: <Uint8Array converted to a string>,
DNSKEY_transmission: "1",
SMIMEA_data: <Uint8Array converted to a string>,
SMIMEA_transmission: "1",
HTTPS_data: <Uint8Array converted to a string>,
HTTPS_transmission: "1",
NEWONE_data: <Uint8Array converted to a string>,
NEWONE_transmission: "1",
NEWTWO_data: <Uint8Array converted to a string>,
NEWTWO_transmission: "1"
```

- We also send a ping at browser startup that simply indicates the beginning of 
the experiment for a given browser session. Similarly, we send another ping 
after the DNS response ping has been sent to indicate the end of the experiment 
for a given browser session. These pings looks like:

```
event: (measurementStart, measurementEnd),
measurement_id: <UUID string goes here>
```

- Lastly, we send a ping if any error occurs, i.e. if UDP sockets failed to 
open, no nameservers could be read from disk, or if a DNS request could not be 
sent. Each error has its own ping. The error pings looks like this:

```
event: (readNameserversError, noNameserversError, noIPv4NameserversError,
openSocketError, sendQueryError),
measurement_id: <UUID string goes here>
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
