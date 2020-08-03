## Major TODOs ##
* Set up custom record types with Cloudflare folks
* Set up TCP sockets to transmit requests side by side with UDP sockets

## Minor TODOs ##
* Figure out if we should set a random ID value for each DNS request
* Come up with a less-hacky way of storing the __proto__ for the object created
  by dns-packet.encode()
* Figure out a better way to include Node.js modules without using browserify on
dns-test.js to create background.js

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
