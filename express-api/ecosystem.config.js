module.exports = {
  apps: [
    {
      name: 'shytalk-api',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 3000,
      },
      max_memory_restart: '400M',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
    },
  ],
};
