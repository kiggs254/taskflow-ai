# Fix Netlify Deployment Issues

## Issue 1: CSS 404 Error ✅ FIXED
**Error**: `GET https://admirable-kashata-cad393.netlify.app/index.css net::ERR_ABORTED 404`

**Cause**: The `index.html` was referencing a non-existent CSS file. The project uses Tailwind CSS via CDN, so this reference was removed.

**Status**: Fixed in code. Redeploy to apply the fix.

## Issue 2: API Connection Refused ❌ NEEDS CONFIGURATION
**Error**: `POST http://localhost:3000/api/ai/daily-motivation net::ERR_CONNECTION_REFUSED`

**Cause**: The `VITE_API_BASE_URL` environment variable is not set in Netlify, so the app is trying to connect to `localhost:3000` (the default fallback).

**Solution**: Set the environment variable in Netlify.

## How to Fix the API Issue

### Step 1: Get Your Backend URL
1. Go to your Coolify dashboard
2. Find your backend application
3. Copy the full URL (e.g., `https://taskflow-api.coolify.app` or `https://api.yourdomain.com`)

### Step 2: Set Environment Variable in Netlify

#### Option A: Via Netlify Dashboard (Recommended)
1. Go to [app.netlify.com](https://app.netlify.com)
2. Select your site: `admirable-kashata-cad393`
3. Go to **Site settings** → **Environment variables**
4. Click **Add variable**
5. Add:
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://your-backend-url.com/api`
     - ⚠️ **Important**: Must end with `/api`
     - Example: `https://taskflow-api.coolify.app/api`
6. Click **Save**
7. **Redeploy** your site:
   - Go to **Deploys** tab
   - Click **Trigger deploy** → **Deploy site**

#### Option B: Via Netlify CLI
```bash
netlify env:set VITE_API_BASE_URL https://your-backend-url.com/api
netlify deploy --prod
```

### Step 3: Verify Backend CORS Settings

Make sure your backend allows requests from your Netlify domain:

1. In Coolify, go to your backend application
2. Environment variables section
3. Set `CORS_ORIGIN` to:
   - `https://admirable-kashata-cad393.netlify.app`
   - Or use `*` for development (not recommended for production)
4. Restart the backend application

### Step 4: Test

After redeploying:
1. Visit your Netlify site
2. Open browser console (F12)
3. Check that API calls now go to your backend URL (not localhost)
4. Test registration/login
5. Test creating a task

## Quick Checklist

- [ ] Removed `/index.css` reference from `index.html` ✅
- [ ] Set `VITE_API_BASE_URL` in Netlify environment variables
- [ ] Value ends with `/api`
- [ ] Redeployed site after setting variable
- [ ] Set `CORS_ORIGIN` in backend to allow Netlify domain
- [ ] Restarted backend after CORS change
- [ ] Tested API calls in browser console

## Verification

After fixing, you should see in the browser console:
- ✅ API calls going to your backend URL (not localhost)
- ✅ No CORS errors
- ✅ Successful API responses
- ✅ No CSS 404 errors

## Still Having Issues?

### API still connecting to localhost?
- Check environment variable name is exactly `VITE_API_BASE_URL`
- Variable must start with `VITE_` for Vite to expose it
- Redeploy after adding/changing the variable
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)

### CORS errors?
- Verify `CORS_ORIGIN` in backend matches your Netlify URL exactly
- Include `https://` in the URL
- Restart backend after changes
- Check backend logs for CORS errors

### Build fails?
- Check Netlify build logs
- Verify Node.js version (should be 18+)
- Check that all dependencies are in `package.json`
