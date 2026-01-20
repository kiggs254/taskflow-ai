# Quick Start Guide - TaskFlow.AI

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Node.js 18+ installed
- PostgreSQL database (local or remote)
- OpenAI API key (or Deepseek API key)
- GitHub account
- Netlify account (for frontend)
- Coolify instance (for backend)

## Step 1: Local Development Setup

### Frontend
```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Edit .env.local and set your backend URL
# VITE_API_BASE_URL=http://localhost:3000/api

# Start development server
npm run dev
```

### Backend
```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your configuration:
# - DATABASE_URL (PostgreSQL connection string)
# - API_SECRET (random secure string)
# - OPENAI_API_KEY
# - DEEPSEEK_API_KEY

# Set up database
psql -U your_user -d your_database -f schema.sql

# Start backend server
npm start
```

## Step 2: Deploy Backend to Coolify

1. **Create PostgreSQL Resource**
   - In Coolify: Resources → New Resource → Databases → PostgreSQL
   - Copy the connection string

2. **Deploy Backend Application**
   - New Resource → Application
   - Connect GitHub repository
   - Set root directory: `backend/`
   - Add environment variables (see `backend/.env.example`)
   - Deploy!

3. **Get Backend URL**
   - Copy your backend URL (e.g., `https://taskflow-api.coolify.app`)

## Step 3: Deploy Frontend to Netlify

1. **Connect Repository**
   - Go to [app.netlify.com](https://app.netlify.com)
   - Add new site → Import from GitHub
   - Select your repository

2. **Configure Build**
   - Build command: `npm run build` (auto-detected)
   - Publish directory: `dist` (auto-detected)

3. **Set Environment Variable**
   - Site settings → Environment variables
   - Add: `VITE_API_BASE_URL` = `https://your-backend-url.com/api`

4. **Deploy**
   - Click "Deploy site"
   - Wait for build to complete

## Step 4: Configure CORS

In your Coolify backend environment variables:
- Set `CORS_ORIGIN` to your Netlify URL
- Example: `https://your-site.netlify.app`

## Step 5: Test

1. Visit your Netlify site
2. Register a new account
3. Create a task
4. Test AI features

## 🎉 Done!

Your TaskFlow.AI app is now live!

## Troubleshooting

**Build fails?**
- Check Node.js version (need 18+)
- Run `npm install` locally first
- Check build logs in Netlify

**API calls fail?**
- Verify `VITE_API_BASE_URL` is set correctly
- Check backend CORS settings
- Test backend URL directly

**CORS errors?**
- Update `CORS_ORIGIN` in backend
- Restart backend after changes
- Check browser console for exact error

## Next Steps

- Custom domain setup
- SSL certificates (auto-handled by Netlify/Coolify)
- Performance optimization
- Monitoring and analytics

For detailed guides:
- Frontend: [NETLIFY_DEPLOY.md](NETLIFY_DEPLOY.md)
- Backend: [backend/README.md](backend/README.md)
- Full deployment: [DEPLOYMENT.md](DEPLOYMENT.md)
