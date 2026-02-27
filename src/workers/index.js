/**
 * Start all channel workers.
 * Called once at application boot.
 */
function startAllWorkers() {
  const workers = [
    require("./push.worker")(),
    require("./email.worker")(),
    require("./sms.worker")(),
    require("./whatsapp.worker")(),
    require("./inapp.worker")(),
  ];

  console.log(`[workers] All ${workers.length} workers started`);
  return workers;
}

module.exports = { startAllWorkers };
