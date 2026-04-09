/**
 * MissionChain AI Orchestra v4.0 — PM2 Ecosystem Config
 * 3-Model Tribunal: Codex (Auditor #1) + Gemini (Auditor #2) + Claude (Builder/Synthesizer)
 *
 * Usage:
 *   mkdir -p logs reports/admin-audit-log   # Create dirs first
 *   pm2 start ecosystem.config.js
 *   pm2 logs mic-commander
 *   pm2 restart mic-commander
 *   pm2 stop all
 *
 * The OpsCommander (NLP bot + Admin AI) is the primary interface.
 * Scheduler runs alongside for automated audits (3-model if GOOGLE_AI_API_KEY set).
 */

module.exports = {
  apps: [
    {
      // PRIMARY: NLP Telegram bot for natural language interaction
      name: "mic-commander",
      script: "ops-commander.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Memory limit (restart if exceeded)
      max_memory_restart: "256M",
      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/commander-error.log",
      out_file: "./logs/commander-out.log",
      merge_logs: true,
      // Watch for config changes (optional)
      watch: false,
    },
    {
      // SCHEDULER: Automated audit cron jobs
      name: "mic-scheduler",
      script: "scheduler.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000,
      max_memory_restart: "256M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/scheduler-error.log",
      out_file: "./logs/scheduler-out.log",
      merge_logs: true,
      watch: false,
    },
    {
      // SETTINGS API: Admin Dashboard REST server
      name: "mic-settings",
      script: "admin-settings-api.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        ADMIN_API_PORT: 3847,
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: "128M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/settings-error.log",
      out_file: "./logs/settings-out.log",
      merge_logs: true,
      watch: false,
    },
  ],
};
