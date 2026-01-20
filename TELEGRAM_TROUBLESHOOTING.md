# Telegram Bot Troubleshooting Guide

## Issue: Bot Not Responding

### Step 1: Check Bot Initialization

Check your backend logs for:
```
✅ Telegram bot started: BotName (@your_bot_username)
Telegram bot handlers set up
```

If you see:
```
TELEGRAM_BOT_TOKEN not set. Telegram bot will not be available.
```
→ **Fix:** Set `TELEGRAM_BOT_TOKEN` in your environment variables

### Step 2: Verify Bot Token

1. Go to Telegram and message `@BotFather`
2. Send `/mybots`
3. Select your bot
4. Click "API Token"
5. Verify the token matches `TELEGRAM_BOT_TOKEN` in your backend

### Step 3: Check Polling vs Webhook

**If using Polling (default):**
- Set `TELEGRAM_USE_WEBHOOK=false` or don't set it
- Bot should automatically poll for messages
- Check logs for: `Initializing Telegram bot with polling mode`

**If using Webhook:**
- Set `TELEGRAM_USE_WEBHOOK=true`
- Set `TELEGRAM_WEBHOOK_URL=https://your-backend-url.com/api/telegram/webhook`
- Webhook must be HTTPS
- Set webhook: `GET https://your-backend-url.com/api/telegram/webhook`

### Step 4: Test Bot Directly

1. Open Telegram
2. Search for your bot by username
3. Send `/start`
4. Bot should respond with welcome message

**If bot doesn't respond:**
- Check backend logs for errors
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check if bot is initialized (look for "Telegram bot initialized" in logs)

### Step 5: Test Linking

1. In TaskFlow app: Settings → Telegram Integration
2. Click "Get Link Code"
3. Copy the code (it's your user ID number)
4. In Telegram, send: `/link YOUR_CODE` (e.g., `/link 1`)
5. Bot should respond: "✅ Successfully linked!"

**If linking fails:**
- Check backend logs for: `Telegram /link command received`
- Verify the code is your user ID (number)
- Check logs for error messages

### Step 6: Check Backend Logs

After sending a message to the bot, check logs for:

**Expected logs:**
```
Telegram /link command received from user 123456789, code: 1
Linking Telegram account: telegramUserId=123456789, code=1
User found: user@example.com
Telegram account linked successfully for user 1
```

**If you see errors:**
- `Invalid linking code` → Code doesn't match any user ID
- `User not found` → User ID doesn't exist in database
- `Telegram bot error` → Bot API issue

## Common Issues

### Issue: "Bot not initialized"
**Cause:** `TELEGRAM_BOT_TOKEN` not set or invalid
**Fix:** Set correct token in environment variables

### Issue: Bot doesn't respond to any commands
**Possible causes:**
1. Bot token is wrong
2. Bot is not polling (check `TELEGRAM_USE_WEBHOOK`)
3. Webhook not set up (if using webhook)
4. Backend not receiving requests

**Debug:**
- Check logs for "Telegram bot initialized"
- Try `/start` command
- Check if bot.getMe() succeeds in logs

### Issue: `/link` command doesn't work
**Possible causes:**
1. Code format is wrong (must be user ID number)
2. User doesn't exist in database
3. Database connection issue

**Debug:**
- Check logs for "Telegram /link command received"
- Verify code is a number (your user ID)
- Check database for user existence

### Issue: Bot responds but app doesn't update
**Possible causes:**
1. Linking succeeded but frontend not refreshing
2. Database update failed silently

**Debug:**
- Check `telegram_integrations` table in database
- Refresh app settings page
- Check backend logs for database queries

## Testing Checklist

- [ ] Bot token is set in environment variables
- [ ] Backend logs show "Telegram bot initialized"
- [ ] Bot responds to `/start` command
- [ ] Can get link code from app settings
- [ ] `/link CODE` command works in Telegram
- [ ] App shows Telegram as "Connected" after linking
- [ ] Can send messages to bot (creates draft tasks)
- [ ] Bot commands work (`/list`, `/add`, etc.)

## Manual Database Check

If linking seems to work but app doesn't show it:

```sql
-- Check if integration exists
SELECT * FROM telegram_integrations WHERE user_id = YOUR_USER_ID;

-- Check user's telegram_user_id
SELECT id, username, telegram_user_id FROM users WHERE id = YOUR_USER_ID;
```

## Still Not Working?

1. **Check all environment variables are set:**
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_USE_WEBHOOK` (optional, defaults to false)
   - `TELEGRAM_WEBHOOK_URL` (only if using webhook)

2. **Restart backend** after setting environment variables

3. **Check backend logs** for any errors or warnings

4. **Test bot directly** with `/start` to verify it's receiving messages

5. **Verify database** has the `telegram_integrations` table (run schema migration)
