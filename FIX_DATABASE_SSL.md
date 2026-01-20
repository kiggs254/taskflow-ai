# Fix Database SSL Connection Error

## Problem
**Error**: "The server does not support SSL connections"

**Cause**: The backend is trying to connect to PostgreSQL with SSL, but your database server doesn't support or require SSL.

## Fix Applied
Updated `backend/src/config/database.js` to:
- Default to **no SSL** (most databases don't require it)
- Allow SSL to be controlled via `DATABASE_SSL` environment variable
- Auto-detect SSL requirements from connection string (`sslmode` parameter)
- Only use SSL for localhost if explicitly configured

## Solution Options

### Option 1: Disable SSL via Environment Variable (Recommended)
In your Coolify backend environment variables, add:
```
DATABASE_SSL=false
```

### Option 2: Update Connection String
If your `DATABASE_URL` includes SSL parameters, you can add `sslmode=disable`:
```
postgresql://user:pass@host:5432/db?sslmode=disable
```

### Option 3: Code Already Fixed (Default Behavior)
The code now defaults to **no SSL**, so if you don't set `DATABASE_SSL`, it will try without SSL first.

## Next Steps

1. **In Coolify Backend**:
   - Go to your backend application
   - Environment variables section
   - Add: `DATABASE_SSL=false`
   - Or remove any SSL-related settings from `DATABASE_URL`

2. **Redeploy Backend**:
   - Restart/redeploy your backend application
   - Check logs to verify database connection succeeds

3. **Test**:
   - Try registering a user again
   - Should work now!

## Verification

After setting `DATABASE_SSL=false` and redeploying:
- ✅ Database connection should succeed
- ✅ Registration should work
- ✅ Login should work
- ✅ No more SSL errors

## Common Database Connection Strings

**Without SSL** (most common):
```
postgresql://user:password@host:5432/database
```

**With SSL disabled explicitly**:
```
postgresql://user:password@host:5432/database?sslmode=disable
```

**With SSL required**:
```
postgresql://user:password@host:5432/database?sslmode=require
```
