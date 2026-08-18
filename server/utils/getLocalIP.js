const os = require("os");

function getLocalIP() {
  const nets = os.networkInterfaces();
  let selectedIP = null;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (
        net.family === "IPv4" &&
        !net.internal && 
        !net.address.startsWith("169.") // avoid invalid auto-assign IP
      ) {
        selectedIP = net.address;
      }
    }
  }

  return selectedIP || "127.0.0.1";
}

module.exports = getLocalIP;
