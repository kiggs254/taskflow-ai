# Deployment Guide - TaskFlow.AI

This guide covers deploying both the frontend and backend of TaskFlow.AI.

## Quick Start

1. **Deploy Backend** → See [backend/README.md](backend/README.md)
2. **Deploy Frontend** → See [NETLIFY_DEPLOY.md](NETLIFY_DEPLOY.md)
3. **Configure CORS** → Update backend `CORS_ORIGIN` with frontend URL
4. **Set Environment Variables** → Configure `VITE_API_BASE_URL` in frontend

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌──────────────┐
│   Netlify       │  HTTPS  │    Coolify      │          │  PostgreSQL  │
│   (Frontend)    │────────▶│   (Backend)     │─────────▶│  (Database)  │
│                 │         │                 │          │              │
│  React + Vite   │         │  Node.js/Express│          │              │
└─────────────────┘         └─────────────────┘          └──────────────┘
                                      │
                                      ▼
                              ┌──────────────┐
                              │   OpenAI &    │
                              │   Deepseek    │
                              └──────────────┘
```

## Deployment Checklist

### Backend (Coolify)
- [ ] PostgreSQL database created
- [ ] Database schema applied (`backend/schema.sql`)
- [ ] Environment variables configured:
  - [ ] `DATABASE_URL`
  - [ ] `API_SECRET`
  - [ ] `OPENAI_API_KEY`
  - [ ] `DEEPSEEK_API_KEY`
  - [ ] `CORS_ORIGIN` (set to frontend URL)
- [ ] Backend deployed and accessible
- [ ] Health check endpoint working (`/`)

### Frontend (Netlify)
- [ ] Repository connected to Netlify
- [ ] Build settings configured:
  - [ ] Build command: `npm run build`
  - [ ] Publish directory: `dist`
- [ ] Environment variable set:
  - [ ] `VITE_API_BASE_URL` = `https://your-backend-url.com/api`
- [ ] Site deployed and accessible
- [ ] Custom domain configured (optional)

### Testing
- [ ] User registration works
- [ ] User login works
- [ ] Tasks can be created
- [ ] AI task parsing works
- [ ] Tasks can be completed
- [ ] No CORS errors in browser console

## Common Issues

### CORS Errors
**Symptom**: Browser console shows CORS errors
**Solution**: 
1. Check backend `CORS_ORIGIN` includes your Netlify URL
2. Ensure it's the exact URL (with `https://`)
3. Restart backend after changing CORS settings

### API 404 Errors
**Symptom**: API calls return 404
**Solution**:
1. Verify `VITE_API_BASE_URL` ends with `/api`
2. Check backend is running and accessible
3. Test backend URL directly in browser

### Environment Variables Not Working
**Symptom**: `VITE_API_BASE_URL` is undefined
**Solution**:
1. Variable must start with `VITE_` prefix
2. Redeploy frontend after adding variables
3. Clear browser cache

## Support

- Frontend Issues: See [NETLIFY_DEPLOY.md](NETLIFY_DEPLOY.md)
- Backend Issues: See [backend/README.md](backend/README.md)
- General: Check GitHub Issues
