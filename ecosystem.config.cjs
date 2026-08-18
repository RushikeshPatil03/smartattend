module.exports = {
  apps: [
    {
      name: "smart-attendance-api",
      cwd: "./server",
      script: "index.js",
      exec_mode: "cluster",
      instances: "max",
      watch: false,
      max_memory_restart: "512M",
      out_file: "./backend.out.log",
      error_file: "./backend.err.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 4000,
        REDIS_URL: "redis://127.0.0.1:6379",
      },
      env_production: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 4000,
        REDIS_URL: "redis://127.0.0.1:6379",
      },
    },
  ],
};
