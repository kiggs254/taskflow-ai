# Fix API URL Issue

## Problem
Frontend is calling `https://taskflowapi.officialstore.ke/?action=register` instead of `https://taskflowapi.officialstore.ke/api?action=register`

## Root Cause
The `VITE_API_BASE_URL` environment variable in Netlify is set to `https://taskflowapi.officialstore.ke` (without `/api`), but the code expects it to end with `/api`.

## Fix Applied
Updated both `apiService.ts` and `geminiService.ts` to automatically append `/api` if it's missing from the environment variable.

## Solution Options

### Option 1: Update Netlify Environment Variable (Recommended)
1. Go to Netlify Dashboard
2. Site settings → Environment variables
3. Update `VITE_API_BASE_URL` to: `https://taskflowapi.officialstore.ke/api`
4. Redeploy site

### Option 2: Keep Current Setting (Code Now Handles It)
The code now automatically adds `/api` if missing, so you can keep:
- `VITE_API_BASE_URL = https://taskflowapi.officialstore.ke`

And it will automatically become: `https://taskflowapi.officialstore.ke/api`

## Testing
After redeploying frontend:
- ✅ Registration should work
- ✅ Login should work
- ✅ All API calls should go to `/api` endpoints

## Next Steps
1. Commit and push the code fix
2. Redeploy frontend on Netlify (or wait for auto-deploy)
3. Test registration/login
