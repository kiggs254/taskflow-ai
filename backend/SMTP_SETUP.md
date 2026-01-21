# SMTP Email Setup Guide

This guide explains how to set up SMTP email functionality for password reset emails in TaskFlow.AI.

## Environment Variables

Add the following environment variables to your `.env` file or hosting platform:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com                    # Your SMTP server hostname
SMTP_PORT=587                                # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                            # true for SSL (port 465), false for TLS (port 587)
SMTP_USER=your-email@gmail.com              # SMTP username (usually your email)
SMTP_PASSWORD=your-app-password             # SMTP password or app-specific password
SMTP_FROM=noreply@taskflow.ai               # From email address (optional, defaults to SMTP_USER)
SMTP_FROM_NAME=TaskFlow.AI                  # From name (optional, defaults to "TaskFlow.AI")

# Frontend URL (for password reset links)
FRONTEND_URL=https://your-frontend-url.com  # Your frontend URL where users will reset passwords
```

## Common SMTP Providers

### Gmail

1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
3. Use these settings:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   ```

### SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=noreply@yourdomain.com
```

### Mailgun

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@yourdomain.mailgun.org
SMTP_PASSWORD=your-mailgun-password
SMTP_FROM=noreply@yourdomain.com
```

### AWS SES

```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com  # Use your region
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-smtp-username
SMTP_PASSWORD=your-ses-smtp-password
SMTP_FROM=noreply@yourdomain.com
```

## Database Migration

Run the password reset tokens migration:

```bash
psql $DATABASE_URL -f backend/migration_add_password_reset_tokens.sql
```

Or manually run the SQL:

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
```

## Install Dependencies

```bash
cd backend
npm install nodemailer
```

## API Endpoints

### Forgot Password

**POST** `/api?action=forgot_password`

Request body:
```json
{
  "email": "user@example.com"
}
```

Response:
```json
{
  "success": true,
  "message": "If an account exists with this email, a password reset link has been sent."
}
```

### Reset Password

**POST** `/api?action=reset_password`

Request body:
```json
{
  "token": "reset-token-from-email",
  "password": "new-password"
}
```

Response:
```json
{
  "success": true,
  "message": "Password reset successfully."
}
```

## Testing

1. Test SMTP connection:
   ```bash
   # The email service will throw an error if SMTP is misconfigured
   # Check backend logs when sending a password reset email
   ```

2. Test forgot password flow:
   - Send POST request to `/api?action=forgot_password` with an email
   - Check email inbox for reset link
   - Use the token from the email to reset password

## Security Notes

- Reset tokens expire after 1 hour
- Tokens can only be used once
- All other tokens for a user are deleted when password is reset
- Email addresses are not revealed if they don't exist (security best practice)
- Passwords must be at least 6 characters long
