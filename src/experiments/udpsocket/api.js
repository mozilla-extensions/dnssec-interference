/* exported udpsocket */

var udpsocket = class udpsocket extends ExtensionAPI {
  getAPI(context) {
    const {extension} = context;
    return {
      experiments: {
        udpsocket: {
          async connect() {
            return 1;
          },
        },
      },
    };
  }
};
