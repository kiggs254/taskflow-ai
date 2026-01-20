# Backend Routing Fix

## Issue
Frontend getting 404 errors when calling `/api?action=register` and other endpoints.

## Root Cause
The query parameter routing wasn't properly handling requests and was returning 404 instead of processing them.

## Fix Applied

1. **Updated `queryParams.js`**:
   - Changed all `res.status(404).json()` to `next()` when action doesn't match
   - This allows requests to fall through to direct routes if query param routing doesn't match

2. **Updated `server.js`**:
   - Added middleware that checks for `?action=` parameter first
   - Only routes to queryParamRoutes if action parameter exists
   - Added explicit 404 handler for unmatched `/api` routes
   - Better error messages for debugging

## How It Works Now

1. Request comes to `/api?action=register`
2. Middleware checks if `action` parameter exists → Yes
3. Routes to `queryParamRoutes` which handles the request
4. If no action parameter, falls through to direct routes (`/api/register`, etc.)

## Testing

After redeploying, test:
- ✅ `POST /api?action=register` - Should work
- ✅ `POST /api?action=login` - Should work  
- ✅ `POST /api/register` - Should still work (direct route)
- ✅ `POST /api/login` - Should still work (direct route)
- ✅ `GET /api?action=get_tasks` - Should work (with auth)
- ✅ `POST /api?action=sync_tasks` - Should work (with auth)

## Next Steps

1. Commit and push the changes
2. Redeploy backend on Coolify
3. Test registration/login from frontend
4. Check backend logs for any errors
