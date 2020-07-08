## Major TODOs ##
* Figure out if we can craft a request for an arbitrary record type
* Set up a DNSSEC-signed record set for a domain name that we control
* Plug in Telemetry code

## Minor TODOs ##
* Figure out if we need to set a random ID value for the DNS request
* Come up with better way of opening/closing sockets for the extension's
  lifetime
    * Do we want a new socket for each query?
    * Do we want a single socket for the extension's lifetime? When do we close
      it?
* Come up with a less-hacky way of storing the __proto__ for the object created
  by dns-packet.encode()

## Bugs ##
* Figure out why we sometimes don't receive the second response when we send two
  requests over two different sockets

## Completed ##
* Document the experiment design
* Figure out how to open a socket and send/receive DNS packets
* Figure out how to read /etc/resolv.conf for Mac/Linux
