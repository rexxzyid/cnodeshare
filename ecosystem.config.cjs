module.exports = {
  apps: [
    {
      name: 'codeshare',
      script: 'src/server.js',
      cwd: __dirname,
      interpreter: 'node',
      node_args: '--enable-source-maps',
      env: {
        NODE_ENV: 'production',
        PORT: '8700'
      },
      autorestart: true,
      max_memory_restart: '512M'
    }
  ]
}
