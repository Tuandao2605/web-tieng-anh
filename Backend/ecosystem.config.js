module.exports = {
  apps: [
    {
      name: "web-hoctienganh-api",
      script: "./dist/src/main.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        NEST_PORT: 3001,
        BACKGROUND_RUNTIME_ROLE: "api"
      }
    },
    {
      name: "web-hoctienganh-workers",
      script: "./dist/src/worker.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        BACKGROUND_RUNTIME_ROLE: "worker",
        ENABLE_EMAIL_WORKER: "true"
      }
    }
  ]
};
