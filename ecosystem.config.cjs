module.exports = {
  apps: [
    {
      name: 'diachinh-local',
      cwd: 'D:\\Documents\\Xiaohongshu_video\\FB_UPLOADER\\diachinh-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
