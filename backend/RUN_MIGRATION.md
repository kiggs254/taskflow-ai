# Database Migration Instructions

## Run Workspace Tab Preferences Migration

To fix the "column does not exist" error, you need to run the migration file to add the new columns to your database.

### Option 1: Using psql command line

```bash
# If you have DATABASE_URL environment variable set:
psql $DATABASE_URL -f backend/migration_add_workspace_tab_preferences.sql

# Or connect directly:
psql -U your_username -d your_database_name -f backend/migration_add_workspace_tab_preferences.sql
```

### Option 2: Using a database GUI tool

1. Open your PostgreSQL database management tool (pgAdmin, DBeaver, etc.)
2. Connect to your database
3. Open and run the SQL file: `backend/migration_add_workspace_tab_preferences.sql`

### Option 3: Copy and paste SQL directly

Copy the contents of `backend/migration_add_workspace_tab_preferences.sql` and run it in your database query tool.

### What this migration does:

- Adds `show_freelance_tab` column (BOOLEAN, default false)
- Adds `show_personal_tab` column (BOOLEAN, default false)  
- Adds `gmail_auto_reply_on_complete` column (BOOLEAN, default false)

The migration uses `IF NOT EXISTS` checks, so it's safe to run multiple times.
