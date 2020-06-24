## TODO ##
* Come up with better way of opening/closing sockets for the extension's
  lifetime
    * Do we want a new socket for each query?
    * Do we want a single socket for the extension's lifetime? When do we close
      it?
* Come up with a less-hacky way of storing the __proto__ for the object created
  by dns-packet.encode()
