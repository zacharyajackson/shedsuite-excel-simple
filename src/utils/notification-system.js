/**
 * Notification system for sending alerts through various channels
 */
const { logger } = require('./logger');
const nodemailer = require('nodemailer');
const axios = require('axios');

class NotificationSystem {
  constructor() {
    this.config = {
      enabled: process.env.ENABLE_NOTIFICATIONS === 'true',
      channels: {
        email: {
          enabled: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
          from: process.env.EMAIL_FROM || 'alerts@shedsuite-excel.com',
          to: process.env.EMAIL_TO || '',
          smtpHost: process.env.SMTP_HOST,
          smtpPort: parseInt(process.env.SMTP_PORT) || 587,
          smtpUser: process.env.SMTP_USER,
          smtpPass: process.env.SMTP_PASS,
          smtpSecure: process.env.SMTP_SECURE === 'true'
        },
        slack: {
          enabled: process.env.ENABLE_SLACK_NOTIFICATIONS === 'true',
          webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
          channel: process.env.SLACK_CHANNEL || '#alerts'
        },
        webhook: {
          enabled: process.env.ENABLE_WEBHOOK_NOTIFICATIONS === 'true',
          url: process.env.WEBHOOK_URL || '',
          method: process.env.WEBHOOK_METHOD || 'POST',
          headers: process.env.WEBHOOK_HEADERS ? JSON.parse(process.env.WEBHOOK_HEADERS) : {}
        }
      },
      throttling: {
        enabled: true,
        maxNotificationsPerMinute: parseInt(process.env.MAX_NOTIFICATIONS_PER_MINUTE) || 5,
        cooldownPeriod: parseInt(process.env.NOTIFICATION_COOLDOWN_MS) || 60000 // 1 minute
      }
    };
    
    this.notificationHistory = [];
    this.notificationCount = 0;
    this.lastNotificationTime = 0;
    
    // Initialize email transporter if configured
    if (this.config.channels.email.enabled && 
        this.config.channels.email.smtpHost && 
        this.config.channels.email.smtpUser) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.config.channels.email.smtpHost,
        port: this.config.channels.email.smtpPort,
        secure: this.config.channels.email.smtpSecure,
        auth: {
          user: this.config.channels.email.smtpUser,
          pass: this.config.channels.email.smtpPass
        }
      });
    }
    
    // Reset notification count periodically
    setInterval(() => {
      this.notificationCount = 0;
    }, this.config.throttling.cooldownPeriod);
  }

  /**
   * Send a notification through configured channels
   * @param {Object} notification Notification details
   * @returns {Promise<Object>} Notification results
   */
  async sendNotification(notification) {
    if (!this.config.enabled) {
      logger.debug('Notifications are disabled');
      return { success: false, reason: 'notifications_disabled' };
    }
    
    // Apply throttling
    if (this.shouldThrottleNotification()) {
      logger.warn('Notification throttled due to rate limiting', { 
        count: this.notificationCount,
        max: this.config.throttling.maxNotificationsPerMinute
      });
      return { success: false, reason: 'throttled' };
    }
    
    // Prepare notification
    const { level, title, message, details } = notification;
    const timestamp = new Date().toISOString();
    const notificationId = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Record notification
    this.notificationCount++;
    this.lastNotificationTime = Date.now();
    
    // Add to history
    this.notificationHistory.unshift({
      id: notificationId,
      level,
      title,
      message,
      timestamp,
      details
    });
    
    // Trim history
    if (this.notificationHistory.length > 100) {
      this.notificationHistory = this.notificationHistory.slice(0, 100);
    }
    
    // Send through each enabled channel
    const results = {
      id: notificationId,
      timestamp,
      channels: {}
    };
    
    try {
      // Email notifications
      if (this.config.channels.email.enabled) {
        results.channels.email = await this.sendEmailNotification({
          level,
          title,
          message,
          details,
          timestamp
        });
      }
      
      // Slack notifications
      if (this.config.channels.slack.enabled) {
        results.channels.slack = await this.sendSlackNotification({
          level,
          title,
          message,
          details,
          timestamp
        });
      }
      
      // Webhook notifications
      if (this.config.channels.webhook.enabled) {
        results.channels.webhook = await this.sendWebhookNotification({
          level,
          title,
          message,
          details,
          timestamp
        });
      }
      
      // Log notification
      logger.info(`Notification sent: ${title}`, {
        notificationId,
        level,
        results
      });
      
      return {
        success: true,
        notificationId,
        results
      };
    } catch (error) {
      logger.error('Failed to send notification:', error);
      return {
        success: false,
        reason: 'error',
        error: error.message
      };
    }
  }

  /**
   * Send an email notification
   * @param {Object} notification Notification details
   * @returns {Promise<Object>} Email send result
   */
  async sendEmailNotification(notification) {
    if (!this.emailTransporter || !this.config.channels.email.to) {
      return { success: false, reason: 'email_not_configured' };
    }
    
    const { level, title, message, details, timestamp } = notification;
    
    // Format email subject based on level
    const subject = `[${level.toUpperCase()}] ${title}`;
    
    // Format email body
    let html = `
      <h2>${title}</h2>
      <p><strong>Level:</strong> ${level}</p>
      <p><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
      <p><strong>Message:</strong> ${message}</p>
    `;
    
    // Add details if available
    if (details) {
      html += `<h3>Details:</h3><pre>${JSON.stringify(details, null, 2)}</pre>`;
    }
    
    try {
      const result = await this.emailTransporter.sendMail({
        from: this.config.channels.email.from,
        to: this.config.channels.email.to,
        subject,
        html
      });
      
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send email notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a Slack notification
   * @param {Object} notification Notification details
   * @returns {Promise<Object>} Slack send result
   */
  async sendSlackNotification(notification) {
    if (!this.config.channels.slack.webhookUrl) {
      return { success: false, reason: 'slack_not_configured' };
    }
    
    const { level, title, message, details, timestamp } = notification;
    
    // Determine color based on level
    const color = level === 'critical' ? '#FF0000' : 
                 level === 'error' ? '#FF9900' : 
                 level === 'warning' ? '#FFCC00' : '#36A64F';
    
    // Format Slack message
    const slackMessage = {
      channel: this.config.channels.slack.channel,
      attachments: [
        {
          color,
          title,
          text: message,
          fields: [
            {
              title: 'Level',
              value: level.toUpperCase(),
              short: true
            },
            {
              title: 'Time',
              value: new Date(timestamp).toLocaleString(),
              short: true
            }
          ],
          footer: 'ShedSuite Excel Integration',
          ts: Math.floor(new Date(timestamp).getTime() / 1000)
        }
      ]
    };
    
    // Add details if available
    if (details) {
      slackMessage.attachments[0].fields.push({
        title: 'Details',
        value: '```' + JSON.stringify(details, null, 2) + '```',
        short: false
      });
    }
    
    try {
      const response = await axios.post(this.config.channels.slack.webhookUrl, slackMessage);
      return { success: response.status === 200, status: response.status };
    } catch (error) {
      logger.error('Failed to send Slack notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a webhook notification
   * @param {Object} notification Notification details
   * @returns {Promise<Object>} Webhook send result
   */
  async sendWebhookNotification(notification) {
    if (!this.config.channels.webhook.url) {
      return { success: false, reason: 'webhook_not_configured' };
    }
    
    const { level, title, message, details, timestamp } = notification;
    
    // Format webhook payload
    const payload = {
      level,
      title,
      message,
      details,
      timestamp,
      source: 'shedsuite-excel'
    };
    
    try {
      const response = await axios({
        method: this.config.channels.webhook.method,
        url: this.config.channels.webhook.url,
        headers: this.config.channels.webhook.headers,
        data: payload
      });
      
      return { success: response.status >= 200 && response.status < 300, status: response.status };
    } catch (error) {
      logger.error('Failed to send webhook notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if notifications should be throttled
   * @returns {boolean} Whether to throttle
   */
  shouldThrottleNotification() {
    if (!this.config.throttling.enabled) {
      return false;
    }
    
    return this.notificationCount >= this.config.throttling.maxNotificationsPerMinute;
  }

  /**
   * Send an alert notification
   * @param {Object} alert Alert information
   * @returns {Promise<Object>} Notification result
   */
  async sendAlertNotification(alert) {
    const { level, message, type, details } = alert;
    
    return this.sendNotification({
      level: level || 'warning',
      title: `Alert: ${type}`,
      message,
      details
    });
  }

  /**
   * Get notification history
   * @param {number} limit Maximum number of notifications to return
   * @returns {Array} Notification history
   */
  getNotificationHistory(limit = 20) {
    return this.notificationHistory.slice(0, limit);
  }

  /**
   * Get notification statistics
   * @returns {Object} Notification statistics
   */
  getNotificationStats() {
    return {
      total: this.notificationHistory.length,
      byLevel: this.notificationHistory.reduce((stats, notification) => {
        const level = notification.level || 'info';
        stats[level] = (stats[level] || 0) + 1;
        return stats;
      }, {}),
      lastSent: this.notificationHistory[0]?.timestamp || null,
      throttling: {
        enabled: this.config.throttling.enabled,
        currentCount: this.notificationCount,
        maxPerMinute: this.config.throttling.maxNotificationsPerMinute
      }
    };
  }
}

// Export a singleton instance
const notificationSystem = new NotificationSystem();

module.exports = notificationSystem;