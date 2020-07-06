"use strict";
/* exported resolvconf */
/* global Components, ExtensionAPI, ExtensionCommon, Services */

var resolvconf = class resolvconf extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        resolvconf: {
          async readResolvConf() {
              console.log("test");
          },
        },
      },
    };
  }
};
