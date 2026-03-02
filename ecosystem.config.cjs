module.exports = {

  apps: [
    {
      name: "bot",
      script: "bun",
      args: "run start",
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
