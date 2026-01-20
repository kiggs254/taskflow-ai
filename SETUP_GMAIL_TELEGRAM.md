# Gmail & Telegram Integration Setup Guide

This guide will walk you through setting up Gmail and Telegram integrations for TaskFlow.AI.

## Prerequisites

- PostgreSQL database running
- Node.js backend deployed (or running locally)
- Frontend deployed (or running locally)
- Google account for Gmail integration
- Telegram account for bot integration

## Step 1: Database Migration

Run the updated schema on your PostgreSQL database:

```bash
# Connect to your database
psql -U your_username -d taskflow_db -f backend/schema.sql

# Or if using a connection string:
psql $DATABASE_URL -f backend/schema.sql
```

This will create the new tables:
- `gmail_integrations`
- `draft_tasks`
- `telegram_integrations`
- Updates to `users` table

## Step 2: Install Backend Dependencies

```bash
cd backend
npm install
```

This will install:
- `googleapis` - Google APIs client
- `node-telegram-bot-api` - Telegram bot framework
- `node-cron` - Scheduled jobs

## Step 3: Set Up Gmail OAuth2

### 3.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it "TaskFlow" (or your preferred name)
4. Click "Create"

### 3.2 Enable Gmail API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Gmail API"
3. Click on it and press "Enable"

### 3.3 Create OAuth2 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure OAuth consent screen first:
   - User Type: External (or Internal if using Google Workspace)
   - App name: TaskFlow.AI
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue"
   - Scopes: Add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.modify`
   - Click "Save and Continue"
   - Test users: Add your email (for testing)
   - Click "Save and Continue"
4. Back to Credentials:
   - Application type: Web application
   - Name: TaskFlow Backend
   - Authorized redirect URIs:
     - `https://your-backend-url.com/api/gmail/callback` (production)
     - `http://localhost:3000/api/gmail/callback` (development)
   - Click "Create"
5. Copy the **Client ID** and **Client Secret**

### 3.4 Add to Environment Variables

Add these to your backend `.env` file or Coolify environment variables:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-backend-url.com/api/gmail/callback
FRONTEND_URL=https://your-frontend-url.com
```

**For development:**
```env
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback
FRONTEND_URL=http://localhost:5173
```

## Step 4: Set Up Telegram Bot

### 4.1 Create Bot via BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow prompts:
   - Choose a name: `TaskFlow AI` (or your choice)
   - Choose a username: `your_taskflow_bot` (must end in `bot`)
4. BotFather will give you a **token** like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### 4.2 Set Bot Commands (Optional but Recommended)

Send to BotFather:
```
/setcommands
@your_taskflow_bot
start - Welcome message and link account
link - Link Telegram to TaskFlow account
add - Add a new task
list - List all pending tasks
today - Show tasks due today
overdue - Show overdue tasks
done - Mark task as complete
help - Show all commands
```

### 4.3 Add to Environment Variables

Add to your backend `.env` file or Coolify:

```env
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_USE_WEBHOOK=false
```

**For production with webhook:**
```env
TELEGRAM_USE_WEBHOOK=true
TELEGRAM_WEBHOOK_URL=https://your-backend-url.com/api/telegram/webhook
```

## Step 5: Set Up Encryption Key

Generate a secure encryption key for OAuth tokens:

```bash
# Generate a 32-byte hex key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to environment variables:

```env
ENCRYPTION_KEY=your-generated-64-character-hex-string
```

**Important:** Keep this key secure! It's used to encrypt OAuth tokens in the database.

## Step 6: Enable Scheduled Jobs

Add to environment variables:

```env
ENABLE_JOBS=true
```

This enables:
- Email scanning (runs every hour)
- Overdue task notifications (runs every hour at :15)
- Daily summaries (runs daily at 9:00 AM)

## Step 7: Complete Environment Variables

Your complete `.env` file should include:

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# API Security
API_SECRET=your-secret-key

# AI Provider API Keys
OPENAI_API_KEY=sk-your-openai-key
DEEPSEEK_API_KEY=sk-your-deepseek-key

# Server Configuration
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://your-frontend-url.com

# Gmail Integration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-backend-url.com/api/gmail/callback
FRONTEND_URL=https://your-frontend-url.com

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_USE_WEBHOOK=false
TELEGRAM_WEBHOOK_URL=https://your-backend-url.com/api/telegram/webhook

# Encryption
ENCRYPTION_KEY=your-64-character-hex-key

# Scheduled Jobs
ENABLE_JOBS=true
```

## Step 8: Restart Backend

After setting all environment variables:

```bash
# If using Coolify, redeploy the backend
# If running locally:
cd backend
npm start
```

## Step 9: Test the Integrations

### Test Gmail Integration

1. Log into your TaskFlow app
2. Go to Settings
3. Find "Gmail Integration" section
4. Click "Connect Gmail"
5. You'll be redirected to Google to authorize
6. After authorization, you'll be redirected back
7. Gmail should show as "Connected"

### Test Telegram Integration

1. In Settings, find "Telegram Integration"
2. Click "Get Link Code"
3. Copy the code shown
4. Open Telegram and search for your bot
5. Send: `/link YOUR_CODE`
6. Bot should respond: "Successfully linked!"
7. Try commands:
   - `/add Fix the login bug`
   - `/list`
   - `/help`

### Test Draft Tasks

1. Connect Gmail and let it scan emails (or click "Scan Now")
2. Send a message to your Telegram bot (it will create a draft)
3. Go to "Draft Tasks" in the navigation
4. You should see tasks extracted from emails/messages
5. Approve or reject them

## Troubleshooting

### Gmail OAuth Issues

- **"Redirect URI mismatch"**: Make sure the redirect URI in Google Cloud Console exactly matches `GOOGLE_REDIRECT_URI`
- **"Access denied"**: Check OAuth consent screen is configured and your email is in test users
- **Token refresh fails**: Check `ENCRYPTION_KEY` is set correctly

### Telegram Bot Issues

- **Bot not responding**: 
  - Check `TELEGRAM_BOT_TOKEN` is correct
  - Verify bot is running (check backend logs)
  - For webhook: Ensure `TELEGRAM_WEBHOOK_URL` is accessible via HTTPS
- **Commands not working**: Make sure you've linked your account with `/link`

### Database Issues

- **Tables not found**: Run the schema migration (Step 1)
- **Connection errors**: Verify `DATABASE_URL` is correct

### Scheduled Jobs Not Running

- Check `ENABLE_JOBS=true` is set
- Check backend logs for job execution
- Verify database connection is working

## Production Deployment Checklist

- [ ] Database migration completed
- [ ] All environment variables set in Coolify
- [ ] Gmail OAuth2 credentials configured
- [ ] Telegram bot created and token added
- [ ] Encryption key generated and set
- [ ] Backend redeployed
- [ ] Test Gmail connection
- [ ] Test Telegram bot
- [ ] Verify scheduled jobs are running (check logs)

## Security Notes

1. **Never commit `.env` files** to git
2. **Encryption key**: Generate a unique key for production
3. **OAuth tokens**: Stored encrypted in database
4. **HTTPS required**: Gmail OAuth requires HTTPS in production
5. **Telegram webhook**: Requires HTTPS for production webhooks

## Next Steps

After setup:
- Configure scan frequency in Gmail settings
- Set up notification preferences in Telegram settings
- Test email scanning with "Scan Now"
- Try creating tasks via Telegram bot
- Review and approve draft tasks

## Support

If you encounter issues:
1. Check backend logs for errors
2. Verify all environment variables are set
3. Test OAuth flow manually
4. Check database for created records
5. Review this guide for missed steps
