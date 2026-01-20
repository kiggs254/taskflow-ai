# Netlify Deployment Guide for TaskFlow.AI Frontend

This guide will help you deploy the TaskFlow.AI frontend to Netlify.

## Prerequisites

1. A GitHub account with the TaskFlow.AI repository
2. A Netlify account (sign up at [netlify.com](https://netlify.com))
3. Your backend API deployed on Coolify (or another hosting service)

## Step 1: Prepare Your Repository

Make sure your repository has:
- ✅ `netlify.toml` configuration file (already included)
- ✅ `package.json` with build scripts
- ✅ All frontend code committed and pushed to GitHub

## Step 2: Deploy to Netlify

### Option A: Deploy via Netlify Dashboard (Recommended)

1. **Log in to Netlify**
   - Go to [app.netlify.com](https://app.netlify.com)
   - Sign in with your GitHub account

2. **Add New Site**
   - Click "Add new site" → "Import an existing project"
   - Select "GitHub" and authorize Netlify
   - Find and select your `taskflow-ai` repository

3. **Configure Build Settings**
   - **Base directory**: Leave empty (root directory)
   - **Build command**: `npm run build` (auto-detected)
   - **Publish directory**: `dist` (auto-detected)
   - Click "Show advanced" and add environment variables (see Step 3)

4. **Set Environment Variables**
   - Click "New variable"
   - Add: `VITE_API_BASE_URL` = `https://your-backend-url.com/api`
     - Replace `your-backend-url.com` with your actual Coolify backend URL
     - Example: `https://api.taskflow.ai/api` or `https://taskflow-backend.coolify.app/api`

5. **Deploy**
   - Click "Deploy site"
   - Netlify will install dependencies, build, and deploy your site
   - Wait for the build to complete (usually 2-3 minutes)

### Option B: Deploy via Netlify CLI

1. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

2. **Login to Netlify**
   ```bash
   netlify login
   ```

3. **Initialize Site**
   ```bash
   netlify init
   ```
   - Follow the prompts to link your site
   - Select "Create & configure a new site"
   - Choose a site name or use the suggested one

4. **Set Environment Variable**
   ```bash
   netlify env:set VITE_API_BASE_URL https://your-backend-url.com/api
   ```

5. **Deploy**
   ```bash
   netlify deploy --prod
   ```

## Step 3: Configure Environment Variables ⚠️ CRITICAL

**This step is REQUIRED. Without it, your app will try to connect to localhost and fail!**

In Netlify Dashboard:
1. Go to **Site settings** → **Environment variables**
2. Click **Add variable**
3. Add the following variable:
   - **Key**: `VITE_API_BASE_URL` (must be exact, case-sensitive)
   - **Value**: Your backend API URL (e.g., `https://api.yourdomain.com/api`)

**Important**: 
- ✅ The value **MUST** include `/api` at the end
- ✅ Use `https://` (not `http://`) for production
- ✅ Variable name **MUST** start with `VITE_` for Vite to expose it
- ⚠️ **After adding, you MUST redeploy** for changes to take effect

**Example values:**
- `https://taskflow-api.coolify.app/api`
- `https://api.taskflow.ai/api`
- `https://your-backend-name.coolify.app/api`

**After setting the variable:**
1. Go to **Deploys** tab
2. Click **Trigger deploy** → **Deploy site**
3. Wait for build to complete

## Step 4: Configure Custom Domain (Optional)

1. Go to **Site settings** → **Domain management**
2. Click "Add custom domain"
3. Enter your domain (e.g., `taskflow.ai`)
4. Follow DNS configuration instructions
5. Netlify will automatically provision SSL certificate

## Step 5: Update Backend CORS

Make sure your backend allows requests from your Netlify domain:

1. In Coolify, go to your backend application
2. Set the `CORS_ORIGIN` environment variable to:
   - Your Netlify URL: `https://your-site.netlify.app`
   - Or your custom domain: `https://taskflow.ai`
   - Or use `*` for development (not recommended for production)

## Step 6: Verify Deployment

1. Visit your Netlify site URL
2. Test the following:
   - ✅ User registration
   - ✅ User login
   - ✅ Creating tasks
   - ✅ AI task parsing
   - ✅ Task completion

## Troubleshooting

### Build Fails

**Error**: "Module not found" or "Cannot find module"
- **Solution**: Make sure all dependencies are in `package.json`
- Run `npm install` locally to verify

**Error**: "VITE_API_BASE_URL is not defined"
- **Solution**: Check that environment variable is set in Netlify dashboard
- Variable name must start with `VITE_` for Vite to expose it

### API Calls Fail

**Error**: "CORS error" or "Network error"
- **Solution**: 
  1. Check backend CORS configuration
  2. Verify `CORS_ORIGIN` in backend includes your Netlify URL
  3. Check browser console for specific error

**Error**: "404 Not Found" on API calls
- **Solution**: 
  1. Verify `VITE_API_BASE_URL` is correct
  2. Make sure it ends with `/api`
  3. Test backend URL directly in browser

### Environment Variables Not Working

- **Solution**: 
  1. Variables must start with `VITE_` to be exposed to frontend
  2. Redeploy after adding/changing variables
  3. Clear browser cache and hard refresh

## Continuous Deployment

Netlify automatically deploys when you push to your main branch:
- Every push to `main` triggers a new deployment
- Pull requests get preview deployments
- You can disable auto-deploy in **Site settings** → **Build & deploy**

## Updating Your Site

1. Make changes to your code
2. Commit and push to GitHub
3. Netlify will automatically build and deploy
4. Check deployment status in Netlify dashboard

## Performance Tips

- Netlify automatically optimizes images and assets
- Enable "Asset optimization" in **Site settings** → **Build & deploy**
- Use Netlify Edge Functions for serverless functions if needed

## Support

- Netlify Docs: [docs.netlify.com](https://docs.netlify.com)
- Netlify Community: [community.netlify.com](https://community.netlify.com)

---

**Next Steps:**
1. Deploy backend to Coolify (see `backend/README.md`)
2. Set `VITE_API_BASE_URL` in Netlify environment variables
3. Configure backend CORS to allow Netlify domain
4. Test the full application
