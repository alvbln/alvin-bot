module.exports = {
  apps: [
    {
      name: "alvin-bot",
      script: "dist/index.js",
      cwd: "/home/user/projects/alvin-bot",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
