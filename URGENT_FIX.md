# 🚨 URGENT: Fix Your Netlify Deployment

## Issues Found

### ✅ Issue 1: CSS 404 Error - FIXED
**Fixed**: Removed the non-existent `/index.css` reference from `index.html`

### ❌ Issue 2: API Connection - ACTION REQUIRED
**Problem**: Your app is trying to connect to `http://localhost:3000/api` instead of your production backend.

**Why**: The `VITE_API_BASE_URL` environment variable is not set in Netlify.

## 🔧 Quick Fix (5 minutes)

### Step 1: Get Your Backend URL
1. Go to your Coolify dashboard
2. Find your backend application
3. Copy the URL (e.g., `https://taskflow-api.coolify.app`)

### Step 2: Set Environment Variable in Netlify

1. **Go to Netlify Dashboard**
   - Visit: https://app.netlify.com
   - Click on your site: `admirable-kashata-cad393`

2. **Navigate to Environment Variables**
   - Click **Site settings** (top menu)
   - Click **Environment variables** (left sidebar)

3. **Add the Variable**
   - Click **Add variable** button
   - **Key**: `VITE_API_BASE_URL` (exact, case-sensitive)
   - **Value**: `https://your-backend-url.com/api`
     - Replace `your-backend-url.com` with your actual Coolify backend URL
     - ⚠️ **MUST end with `/api`**
   - Click **Save**

4. **Redeploy Your Site** (CRITICAL!)
   - Go to **Deploys** tab
   - Click **Trigger deploy** → **Deploy site**
   - Wait for build to complete (~2-3 minutes)

### Step 3: Verify Backend CORS

In your Coolify backend:
1. Go to your backend application
2. Environment variables section
3. Set `CORS_ORIGIN` to: `https://admirable-kashata-cad393.netlify.app`
4. Restart the backend

### Step 4: Test

1. Visit: https://admirable-kashata-cad393.netlify.app
2. Open browser console (F12)
3. Check Network tab - API calls should now go to your backend URL (not localhost)
4. Try registering/logging in

## ✅ Verification Checklist

After redeploying, check:
- [ ] No CSS 404 errors in console
- [ ] API calls go to your backend URL (check Network tab)
- [ ] No "ERR_CONNECTION_REFUSED" errors
- [ ] Registration/login works
- [ ] Tasks can be created

## 📝 Example Values

**If your backend is at:**
- `https://taskflow-api.coolify.app` 
  → Set `VITE_API_BASE_URL` = `https://taskflow-api.coolify.app/api`

- `https://api.taskflow.ai`
  → Set `VITE_API_BASE_URL` = `https://api.taskflow.ai/api`

## 🆘 Still Not Working?

1. **Double-check variable name**: Must be exactly `VITE_API_BASE_URL`
2. **Check the value ends with `/api`**: `https://your-url.com/api`
3. **Redeploy after setting**: Changes only apply after redeploy
4. **Clear browser cache**: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
5. **Check backend CORS**: Must allow your Netlify domain

## 📚 More Help

- Detailed guide: [FIX_NETLIFY_ISSUES.md](FIX_NETLIFY_ISSUES.md)
- Full deployment: [NETLIFY_DEPLOY.md](NETLIFY_DEPLOY.md)
