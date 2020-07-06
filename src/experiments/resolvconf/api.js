"use strict";
/* exported resolvconf */
/* global Components, ExtensionAPI, ExtensionCommon, Services, OS */

const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");

var resolvconf = class resolvconf extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        resolvconf: {
          async readResolvConf() {
              let string1 = await OS.File.read("/etc/resolv.conf", { "encoding": "utf-8" });
              let lines = string1.split("\n");

              let nameservers = [];
              for (var i = 0; i < lines.length; i++) {
                  let line = lines[i];
                  if (line.startsWith("nameserver")) {
                    let ns = line.split(" ")[1];
                    nameservers.push(ns);
                  }
              }
              return nameservers;
          },
        },
      },
    };
  }
};
