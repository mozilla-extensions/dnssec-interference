## Major TODOs ##
* Document the experiment design
* Figure out how to read the system resolver address from disk
    * Windows: registries (see Chrome code for registry locations)
    * Linux: /etc/resolv.conf
* Figure out if we can craft a request for an arbitrary record type
* Set up a DNSSEC-signed record set for a domain name that we control
* Plug in Telemetry code

## Minor TODOs ##
* Come up with better way of opening/closing sockets for the extension's
  lifetime
    * Do we want a new socket for each query?
    * Do we want a single socket for the extension's lifetime? When do we close
      it?
* Come up with a less-hacky way of storing the __proto__ for the object created
  by dns-packet.encode()
