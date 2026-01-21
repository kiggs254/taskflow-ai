# Slack Integration Setup Guide

This guide will walk you through setting up Slack integration to monitor mentions and automatically create draft tasks.

## Prerequisites

- Slack workspace admin access (or permission to install apps)
- Node.js backend deployed
- Frontend deployed

## Step 1: Create Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Enter app name: "TaskFlow.AI" (or your preferred name)
5. Select your workspace
6. Click "Create App"

## Step 2: Configure OAuth & Permissions

1. In your app settings, go to "OAuth & Permissions" in the sidebar
2. Scroll to "Redirect URLs"
3. Add your redirect URL:
   - `https://your-backend-url.com/api/slack/callback`
   - For development: `http://localhost:3000/api/slack/callback`
4. Scroll to "Scopes" → "Bot Token Scopes"
5. Add the following scopes:
   - `app_mentions:read` - Read mentions of the app
   - `channels:read` - List public channels (required to find channels)
   - `channels:history` - Read messages in public channels
   - `groups:read` - List private channels (required to find channels)
   - `groups:history` - Read messages in private channels
   - `im:history` - Read direct messages
   - `users:read` - Read user information
   - `chat:write` - Allow the app to post messages (needed for daily summaries to #tech-team-daily-tasks)
6. Scroll to "User Token Scopes" (if needed)
   - Usually not required for this integration

## Step 3: Install App to Workspace

1. In "OAuth & Permissions", scroll to top
2. Click "Install to Workspace"
3. Review permissions and click "Allow"
4. You'll be redirected and see:
   - **Bot User OAuth Token** (starts with `xoxb-`)
   - **Client ID**
   - **Client Secret**

## Step 4: Copy Credentials

Copy these values:
- **Client ID** (from "Basic Information" → "App Credentials")
- **Client Secret** (from "Basic Information" → "App Credentials")

## Step 5: Set Environment Variables

Add to your backend `.env` file or Coolify:

```env
# Slack Integration
SLACK_CLIENT_ID=your-client-id-here
SLACK_CLIENT_SECRET=your-client-secret-here
SLACK_REDIRECT_URI=https://your-backend-url.com/api/slack/callback
```

**For development:**
```env
SLACK_REDIRECT_URI=http://localhost:3000/api/slack/callback
```

## Step 6: Run Database Migration

Add the Slack integrations table:

```sql
-- Run this SQL on your database
CREATE TABLE IF NOT EXISTS slack_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slack_user_id VARCHAR(255) NOT NULL,
    slack_team_id VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_scan_at TIMESTAMP WITH TIME ZONE,
    scan_frequency INTEGER DEFAULT 15,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id),
    UNIQUE(slack_user_id, slack_team_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_integrations_user_id ON slack_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_slack_integrations_slack_user_id ON slack_integrations(slack_user_id);
```

Or run the full schema:
```bash
psql $DATABASE_URL -f backend/schema.sql
```

## Step 7: Install Backend Dependencies

```bash
cd backend
npm install
```

This will install `@slack/web-api`.

## Step 8: Restart Backend

Redeploy on Coolify or restart locally.

## Step 9: Connect Slack in App

1. Log into your TaskFlow app
2. Go to Settings
3. Find "Slack Integration" section
4. Click "Connect Slack"
5. You'll be redirected to Slack to authorize
6. After authorization, you'll be redirected back
7. Slack should show as "Connected"

## Step 10: Test the Integration

1. In Slack, mention yourself in a channel:
   ```
   @yourname Can you fix the login bug?
   ```
2. Wait up to 15 minutes (or click "Scan Now" in settings)
3. Go to Draft Tasks in the app
4. You should see a draft task created from the mention

## How It Works

1. **Monitoring**: The system scans your Slack channels every 15 minutes (configurable)
2. **Mention Detection**: Finds messages where you're mentioned (`@yourname`)
3. **AI Analysis**: Uses AI to determine if the mention is a task
4. **Draft Creation**: Creates a draft task if AI detects it's actionable
5. **Approval**: You review and approve/reject drafts in the app

## Configuration Options

In Settings → Slack Integration, you can:
- **Scan Frequency**: How often to check for mentions (5-60 minutes)
- **Scan Now**: Manually trigger a scan
- **Disconnect**: Remove Slack integration

## Troubleshooting

### "Slack OAuth credentials not configured"
- Check `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set
- Verify they match your Slack app credentials

### "Failed to get Slack channels"
- Check OAuth scopes are correct
- Verify app is installed to workspace
- Check token hasn't expired

### "No mentions found"
- Make sure you're mentioned in channels the app has access to
- Check that messages are recent (after last scan)
- Try "Scan Now" to force a scan

### Mentions not creating tasks
- AI might not detect the mention as a task
- Check draft tasks view - rejected drafts won't show
- Try more explicit task language: "Can you do X?", "Please fix Y"

## Security Notes

- Access tokens are encrypted in the database
- Only messages where you're mentioned are processed
- App only reads messages, never writes
- You can disconnect at any time

## Next Steps

After setup:
- Configure scan frequency (default: 15 minutes)
- Test with a mention in Slack
- Review draft tasks and approve relevant ones
- Adjust AI confidence threshold if needed
