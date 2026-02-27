const { createChannelWorker } = require("./base.worker");
module.exports = () => createChannelWorker("email");
