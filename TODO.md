## Major TODOs ##
* Set up custom record types with Cloudflare folks
* Check with ekr whether we just want RDATA or the whole DNS response
* Check with ekr whether it's ok to use UDP for RRSIG, DNSKEY, and SMIMEA

## Minor TODOs ##
* Figure out if we need to set a random ID value for the DNS request
* Come up with a less-hacky way of storing the __proto__ for the object created
  by dns-packet.encode()
* Figure out a better way to include Node.js modules without using browserify on
dns-test.js to create background.js

## Bugs ##
* Figure out why we sometimes don't receive the second response when we send one
request over an IPv4 socket and another request over an IPv6 socket -- Likely 
wontfix; will just use IPv4 sockets

## Completed ##
* Document the experiment design
* Figure out how to open a socket and send/receive DNS packets
* Figure out how to read /etc/resolv.conf for list of nameservers on Mac/Linux
* Figure out how to read registries for list of nameservers on Windows
* Figure out if we can craft a request for an arbitrary record type
* Set up a DNSSEC-signed record set for a domain name that we control
* Plug in Telemetry code
* Create a unique IPv4 socket per RRtype in order to know which response we 
didn't receive
* Add random UUID to pings that will be used each time the extension is loaded
