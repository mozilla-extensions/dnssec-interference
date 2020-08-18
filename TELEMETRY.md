## Usual Firefox Telemetry is mostly unaffected

- No change: `main` and other pings are UNAFFECTED by this add-on.
- Respects telemetry preferences. If a client has disabled telemetry, no telemetry 
will be sent for that client.

## Study-specific endings

- This study has no study-specific endings.

## Choice of telemetry API

- We will use the [browser.telemetry.submitPing()](https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/collection/webextension-api.html) API to submit custom pings
  for our study.

## Custom pings, specific to THIS study.

- This add-on opens UDP and TCP sockets at browser startup and sends DNS requests for 
names in a zone that we control (\*.dnssec-experiment-moz.net). We request seven different resource record types, 
re-transmitting if necessary: 

  - A
  - RRSIG
  - DNSKEY
  - SMIMEA
  - HTTPS
  - NEWONE (a custom resource record type that we created for this study)
  - NEWTWO (an additional custom resource record type that we created for this study)

- We wait for the DNS 
responses and then encapsulate the raw bytes into a ping, excluding any IP or UDP headers. For each 
record type, we also record how many times we attempted to query the record type. An example ping
containing the DNS responses takes the following form:

```
{
  "id": "d7754449-8cb1-4df6-b07b-c60dab6f5d66",
  "creationDate": "2020-08-10T01:01:01.145Z",
  "application": { ... },
  "environment": { ... },
  "clientId": "c4582ba1-79fc-1f47-ae2a-671118dccd8b",
  "type": "dnssec-study-v1",
  "version": 4,
  "payload": {
    "measurementID": "e76962aa-a28f-4893-b3bf-fa2e33789e5d",
    "reason": "STUDY_MEASUREMENT_END",
    "dnsData": {
      "udpA": [1, 2, 3],
      "tcpA": [1, 2, 3],
      "udpRRSIG": [1, 2, 3],
      "tcpRRSIG": [1, 2, 3],
      "udpDNSKEY": [1, 2, 3],
      "tcpDNSKEY": [1, 2, 3],
      "udpSMIMEA": [1, 2, 3],
      "tcpSMIMEA": [1, 2, 3],
      "udpHTTPS": [1, 2, 3],
      "tcpHTTPS": [1, 2, 3],
      "udpNEWONE": [1, 2, 3],
      "tcpNEWONE": [1, 2, 3],
      "udpNEWTWO": [1, 2, 3],
      "tcpNEWTWO": [1, 2, 3]
    },
    "dnsAttempts": {
      "udpA": 1,
      "tcpA": 1,
      "udpRRSIG": 1,
      "tcpRRSIG": 1,
      "udpDNSKEY": 1,
      "tcpDNSKEY": 1,
      "udpSMIMEA": 1,
      "tcpSMIMEA": 1,
      "udpHTTPS": 1,
      "tcpHTTPS": 1,
      "udpNEWONE": 1,
      "tcpNEWONE": 1,
      "udpNEWTWO": 1,
      "tcpNEWTWO": 1
    }
  }
}
```

- We also send a ping at browser startup that simply indicates the beginning of 
the experiment for a given browser session. This ping takes the following form:

```
{
  "id": "d7754449-8cb1-4df6-b07b-c60dab6f5d66",
  "creationDate": "2020-08-10T01:01:01.145Z",
  "application": { ... },
  "environment": { ... },
  "clientId": "c4582ba1-79fc-1f47-ae2a-671118dccd8b",
  "type": "dnssec-study-v1",
  "version": 4,
  "payload": {
    "measurementID": "e76962aa-a28f-4893-b3bf-fa2e33789e5d",
    "reason": "STUDY_START"
  }
}
```

- Lastly, we send a ping if any error occurs, i.e. if UDP sockets fail to 
open, if nameservers couldn't be read from disk, or if a DNS request could not be 
sent. These pings take the following form:

```
{
  "id": "d7754449-8cb1-4df6-b07b-c60dab6f5d66",
  "creationDate": "2020-08-10T01:01:01.145Z",
  "application": { ... },
  "environment": { ... },
  "clientId": "c4582ba1-79fc-1f47-ae2a-671118dccd8b",
  "type": "dnssec-study-v1",
  "version": 4,
  "payload": {
    "measurementID": "e76962aa-a28f-4893-b3bf-fa2e33789e5d",
    "reason": ("readNameserversFileError", 
               "STUDY_ERROR_UDP_MISC",
               "STUDY_ERROR_UDP_ENCODE",
               "STUDY_ERROR_UDP_PREMATURE_CLOSE",
               "STUDY_ERROR_UDP_BYTES_WRITTEN",
               "STUDY_ERROR_UDP_QUERY_TIMEOUT",
               "STUDY_ERROR_TCP_MISC",
               "STUDY_ERROR_TCP_ENCODE",
               "STUDY_ERROR_TCP_NETWORK_TIMEOUT",
               "STUDY_ERROR_TCP_NETWORK_MISC",
               "STUDY_ERROR_TCP_CONNECTION_REFUSED",
               "STUDY_ERROR_TCP_NOT_ENOUGH_BYTES",
               "STUDY_ERROR_TCP_TOO_MANY_BYTES",
               "STUDY_ERROR_NAMESERVERS_OS_NOT_SUPPORTED",
               "STUDY_ERROR_NAMESERVERS_NOT_FOUND",
               "STUDY_ERROR_NAMESERVERS_MISC")
  }
}
```

- In all of the pings, `measurementID` is a UUID that is added to represent a
  particular instance of our measurements for a given client. In essence, it is 
  a session ID, since our measurements should only run once at browser startup.

# Performance optimizations affecting submitted telemetry

- Instead of sending a separate ping for each DNS response, we wait for all of 
the DNS responses to return, re-transmitting lost packets if necessary. We then 
encapsulate the DNS responses into a single ping.
- If we receive the correct responses for each DNS request, then the size of the
ping containing the responses should be at most 4-5 KB.
- As previously noted, we only run the measurements once per browser startup.
