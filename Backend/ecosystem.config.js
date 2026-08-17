module.exports = {
  apps: [
    {
      name: "web-hoctienganh-api",
      script: "./dist/src/app.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
