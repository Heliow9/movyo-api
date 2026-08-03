module.exports = {
  apps: [
    {
      name: "movyo-api",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_memory_restart: "750M",
      kill_timeout: 10000,
      ignore_watch: [
        "sessions",
        "uploads",
        "logs",
        ".pm2",
        "node_modules"
      ],
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
