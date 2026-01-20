# 🔒 Fix HTTPS Mixed Content Error

## Problem

**Error**: `Mixed Content: The page at 'https://admirable-kashata-cad393.netlify.app/' was loaded over HTTPS, but requested an insecure resource 'http://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api/...'`

**Cause**: Your Netlify frontend is served over HTTPS, but your backend URL is using HTTP. Browsers block HTTP requests from HTTPS pages for security.

## Solution

You need to use **HTTPS** for your backend URL. There are two options:

### Option 1: Enable HTTPS on Coolify Backend (Recommended)

1. **In Coolify Dashboard:**
   - Go to your backend application
   - Check if HTTPS/SSL is enabled
   - If not, enable it:
     - Go to **Settings** → **SSL/TLS**
     - Enable **Let's Encrypt** or configure your SSL certificate
     - Coolify will automatically provision HTTPS

2. **Get Your HTTPS URL:**
   - After enabling SSL, your backend URL should be:
     - `https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io`
     - Or your custom domain if configured

3. **Update Netlify Environment Variable:**
   - Go to Netlify → Your Site → **Site settings** → **Environment variables**
   - Update `VITE_API_BASE_URL` to:
     - `https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api`
     - ⚠️ **Change `http://` to `https://`**
   - **Redeploy** your site

### Option 2: Use Custom Domain with HTTPS

If you have a custom domain:

1. **Configure Domain in Coolify:**
   - Add your domain to the backend application
   - Enable SSL/HTTPS
   - Example: `https://api.yourdomain.com`

2. **Update Netlify Environment Variable:**
   - Set `VITE_API_BASE_URL` = `https://api.yourdomain.com/api`
   - Redeploy

## Quick Fix Steps

### Step 1: Enable HTTPS in Coolify
1. Open Coolify dashboard
2. Select your backend application
3. Go to **Settings** → **SSL/TLS**
4. Enable **Let's Encrypt** (or your SSL provider)
5. Wait for SSL certificate to be provisioned

### Step 2: Update Environment Variable
1. Go to Netlify: https://app.netlify.com
2. Select your site: `admirable-kashata-cad393`
3. **Site settings** → **Environment variables**
4. Edit `VITE_API_BASE_URL`
5. Change from:
   ```
   http://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api
   ```
   To:
   ```
   https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api
   ```
6. Click **Save**

### Step 3: Redeploy
1. Go to **Deploys** tab
2. Click **Trigger deploy** → **Deploy site**
3. Wait for build to complete

### Step 4: Verify
1. Visit your Netlify site
2. Open browser console (F12)
3. Check Network tab - all API calls should use `https://`
4. No more "Mixed Content" errors

## Verification

After fixing, you should see:
- ✅ All API calls use `https://` (not `http://`)
- ✅ No "Mixed Content" errors in console
- ✅ API calls succeed
- ✅ Tasks can be created and synced

## Troubleshooting

### HTTPS not working in Coolify?
- Check if Let's Encrypt is enabled
- Verify domain DNS is configured correctly
- Check Coolify logs for SSL errors
- Try accessing backend URL directly in browser (should show HTTPS)

### Still getting Mixed Content errors?
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
- Check Network tab to verify requests use HTTPS
- Verify environment variable is updated and site is redeployed
- Check that backend actually serves HTTPS (test in browser)

### Backend returns SSL errors?
- Verify SSL certificate is valid
- Check certificate expiration
- Ensure domain matches certificate
- Check Coolify SSL configuration

## Important Notes

- **Always use HTTPS in production** for security
- Browsers will block HTTP requests from HTTPS pages
- Coolify supports automatic HTTPS via Let's Encrypt
- SSL certificates are free with Let's Encrypt

## Next Steps

1. ✅ Enable HTTPS on Coolify backend
2. ✅ Update `VITE_API_BASE_URL` to use `https://`
3. ✅ Redeploy Netlify site
4. ✅ Test API calls
5. ✅ Verify no Mixed Content errors
