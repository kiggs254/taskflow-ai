import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

/**
 * Create SMTP transporter
 */
const createTransporter = () => {
  // SMTP configuration from environment variables
  const smtpConfig = {
    host: config.smtp?.host || process.env.SMTP_HOST,
    port: parseInt(config.smtp?.port || process.env.SMTP_PORT || '587', 10),
    secure: config.smtp?.secure || process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: config.smtp?.user || process.env.SMTP_USER,
      pass: config.smtp?.pass || process.env.SMTP_PASSWORD,
    },
  };

  // Validate SMTP config
  if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
    throw new Error('SMTP configuration is incomplete. Please set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables.');
  }

  return nodemailer.createTransport(smtpConfig);
};

/**
 * Send email using SMTP
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = createTransporter();
    const fromEmail = config.smtp?.from || process.env.SMTP_FROM || config.smtp?.user || process.env.SMTP_USER;
    const fromName = config.smtp?.fromName || process.env.SMTP_FROM_NAME || 'TaskFlow.AI';

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML tags for text version
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
  const subject = 'Reset Your TaskFlow.AI Password';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">TaskFlow.AI</h1>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0;">
        <h2 style="color: #333; margin-top: 0;">Reset Your Password</h2>
        <p>Hello,</p>
        <p>We received a request to reset your password for your TaskFlow.AI account. Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="background: #fff; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px; color: #666;">${resetUrl}</p>
        <p style="color: #999; font-size: 14px; margin-top: 30px;">This link will expire in 1 hour.</p>
        <p style="color: #999; font-size: 14px;">If you didn't request a password reset, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">© ${new Date().getFullYear()} TaskFlow.AI. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/**
 * End-of-day report email.
 * Reuses the branded shell from the password reset mail.
 */
export const sendDailyReportEmail = async (to, report) => {
  const { date, items, counts, commitCount } = report;
  const subject = `Your day: ${counts.tasks} task${counts.tasks === 1 ? '' : 's'} completed — ${date}`;

  const renderItem = (item) => {
    const subs = (item.subtasks || [])
      .map(
        (s) =>
          `<li style="color:${s.completed ? '#333' : '#999'};">${s.completed ? '✓' : '○'} ${escapeHtml(s.title)}</li>`
      )
      .join('');

    return `
      <div style="padding:12px 0;border-bottom:1px solid #eee;">
        <div style="font-weight:600;color:#333;">
          ${escapeHtml(item.title)}
          ${item.fromCommits ? '<span style="background:#eef2ff;color:#4f46e5;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;">code</span>' : ''}
        </div>
        ${subs ? `<ul style="margin:8px 0 0;padding-left:20px;font-size:14px;">${subs}</ul>` : ''}
      </div>`;
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Daily Report</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height:1.6; color:#333; max-width:600px; margin:0 auto; padding:20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:30px; text-align:center; border-radius:10px 10px 0 0;">
        <h1 style="color:white; margin:0; font-size:28px;">TaskFlow.AI</h1>
        <p style="color:rgba(255,255,255,.85); margin:6px 0 0; font-size:14px;">Daily report — ${escapeHtml(date)}</p>
      </div>
      <div style="background:#f9f9f9; padding:30px; border-radius:0 0 10px 10px; border:1px solid #e0e0e0;">
        <p style="margin-top:0;">
          You completed <strong>${counts.tasks}</strong> task${counts.tasks === 1 ? '' : 's'}${
            counts.subtasks ? ` and <strong>${counts.subtasks}</strong> subtask${counts.subtasks === 1 ? '' : 's'}` : ''
          }${commitCount ? `, including <strong>${commitCount}</strong> from code you shipped` : ''}.
        </p>
        ${items.map(renderItem).join('')}
        <p style="font-size:12px;color:#999;margin-bottom:0;margin-top:20px;">
          Sent automatically by TaskFlow.AI because you had commits today.
        </p>
      </div>
    </body>
    </html>
  `;

  const text =
    `Daily report — ${date}\n\n` +
    items
      .map(
        (i) =>
          `- ${i.title}` +
          (i.subtasks || []).map((s) => `\n    ${s.completed ? '[x]' : '[ ]'} ${s.title}`).join('')
      )
      .join('\n');

  return sendEmail({ to, subject, html, text });
};
