module.exports = {
  apps: [
    {
      name: "movyo-api",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      watch: true,
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
