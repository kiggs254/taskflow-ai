# 🚨 URGENT: Fix HTTPS Mixed Content Error

## The Problem

Your Netlify frontend (HTTPS) is trying to connect to your backend (HTTP), which browsers block for security.

**Error**: `Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure resource 'http://...'`

**Your Backend URL**: `http://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io`

## ⚡ Quick Fix (3 Steps)

### Step 1: Enable HTTPS on Coolify Backend

1. **Open Coolify Dashboard**
2. **Select your backend application**
3. **Go to Settings → SSL/TLS**
4. **Enable Let's Encrypt** (or your SSL provider)
5. **Wait for SSL certificate to be provisioned** (~1-2 minutes)
6. **Your backend URL will now be HTTPS**: 
   - `https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io`

### Step 2: Update Netlify Environment Variable

1. **Go to Netlify**: https://app.netlify.com
2. **Select your site**: `admirable-kashata-cad393`
3. **Site settings** → **Environment variables**
4. **Edit `VITE_API_BASE_URL`**
5. **Change from**:
   ```
   http://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api
   ```
   **To**:
   ```
   https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io/api
   ```
   ⚠️ **Just change `http://` to `https://`**
6. **Click Save**

### Step 3: Redeploy Netlify Site

1. **Go to Deploys tab**
2. **Click "Trigger deploy" → "Deploy site"**
3. **Wait for build** (~2-3 minutes)

## ✅ Verify It's Fixed

1. Visit your Netlify site
2. Open browser console (F12)
3. Check Network tab
4. All API calls should now use `https://` (not `http://`)
5. No more "Mixed Content" errors
6. Tasks should sync successfully

## 🎯 What Changed?

- **Before**: Frontend (HTTPS) → Backend (HTTP) ❌ Blocked by browser
- **After**: Frontend (HTTPS) → Backend (HTTPS) ✅ Works!

## 📝 Notes

- Coolify provides free SSL via Let's Encrypt
- HTTPS is required when frontend uses HTTPS
- This is a browser security feature (can't be bypassed)
- All production apps should use HTTPS

## 🆘 Still Not Working?

1. **Verify backend HTTPS works**: 
   - Open `https://po4kc00gsoccok8sc88skgg0.45.79.122.81.sslip.io` in browser
   - Should show SSL lock icon ✅

2. **Check environment variable**:
   - Must be exactly `VITE_API_BASE_URL`
   - Value must start with `https://`
   - Must end with `/api`

3. **Clear browser cache**: 
   - Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

4. **Check Coolify SSL status**:
   - Verify SSL certificate is active
   - Check for any SSL errors in Coolify logs

## 📚 More Details

See [FIX_HTTPS_ISSUE.md](FIX_HTTPS_ISSUE.md) for detailed troubleshooting.
