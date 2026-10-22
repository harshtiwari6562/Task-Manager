module.exports = {
  apps: [
    {
      name: 'traject-backend',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      max_memory_restart: '500M',
    },
  ],
};
