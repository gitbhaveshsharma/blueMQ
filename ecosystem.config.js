module.exports = {
  apps: [
    {
      name: "bluemq",
      script: "src/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
	NODE_OPTIONS: "--dns-result-order=ipv4first",
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3001,
      },
      error_file: "./logs/bluemq-error.log",
      out_file: "./logs/bluemq-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};
