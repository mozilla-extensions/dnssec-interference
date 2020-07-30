# Telemetry sent by this add-on

**Contents**

- [Usual Firefox Telemetry is mostly unaffected](#usual-firefox-telemetry-is-mostly-unaffected)
- [Study-specific endings](#study-specific-endings)
- [`shield-study` pings (common to all shield-studies)](#shield-study-pings-common-to-all-shield-studies)
- [`shield-study-addon` pings, specific to THIS study.](#shield-study-addon-pings-specific-to-this-study)
- [Performance optimizations affecting submitted telemetry](#performance-optimizations-affecting-submitted-telemetry)

## Usual Firefox Telemetry is mostly unaffected

- `main` pings are UNAFFECTED by this add-on, but we do send several `event` pings on browser startup.
- Respects telemetry preferences. If user has disabled telemetry, no telemetry will be sent.

## Study-specific endings

This study has no study-specific endings.

## `event` pings, specific to THIS study.

- This add-on opens UDP sockets at browser startup and sends DNS requests for a domain name that we control. We request seven different record types, re-transmitting after a fixed timeout if necessary. We wait for the responses and then encapsulate the raw bytes into the `value` field for an `event` ping, keyed by record type. For each record type, we also record how many transmissions were sent. 

- We also an `event` ping at browser startup that simply indicates the beginning of the experiment for a given browser session. Similarly, we send another `event` ping after the DNS response ping has been sent to indicate the end of the experiment for a given browser session.

- Lastly, we send an `event` ping if any error occurs, i.e. if UDP sockets failed to open, no nameservers could be read from disk, or if a DNS request could not be sent. The event ping contains each error that occurred.

- Event pings are sent using the [browser.telemetry API](https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/collection/webextension-api.html). Each of the aforementioned pings contain a client ID, session ID, and environment data.

# Performance optimizations affecting submitted telemetry

- Instead of sending an `event` ping for each DNS response, we wait a fixed amount
  of time for each DNS response to return. We then encapsulate the results of
  each query into a single `event` ping.
- If we receive the correct responses for each DNS request, then the size of the
  data for the `event` ping containing the responses should be at most 2-3 KB.
- As previously noted, we only run the measurements once per browser startup.
