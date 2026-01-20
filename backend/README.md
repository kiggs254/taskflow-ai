# TaskFlow.AI Backend

Node.js/Express backend for TaskFlow.AI task management application.

## Features

- RESTful API with PostgreSQL database
- JWT-like token authentication
- AI integration with OpenAI and Deepseek
- Task management with gamification (XP, levels, streaks)
- CORS support for Netlify frontend

## Prerequisites

- Node.js 18+ 
- PostgreSQL database
- OpenAI API key (optional, for AI features)
- Deepseek API key (optional, for AI features)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration:
   - `DATABASE_URL`: PostgreSQL connection string
   - `API_SECRET`: Secret key for token signing
   - `OPENAI_API_KEY`: OpenAI API key
   - `DEEPSEEK_API_KEY`: Deepseek API key
   - `CORS_ORIGIN`: Frontend origin (Netlify URL)

4. Set up the database:
```bash
# Connect to your PostgreSQL database and run:
psql -U your_user -d your_database -f schema.sql
```

## Running

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

Server will start on port 3000 (or PORT from .env).

## API Endpoints

### Authentication
- `POST /api?action=register` - Register new user
- `POST /api?action=login` - Login user

### Tasks
- `GET /api?action=get_tasks` - Get all user tasks (requires auth)
- `POST /api?action=sync_tasks` - Create/update task (requires auth)
- `POST /api?action=delete_task` - Delete task (requires auth)
- `POST /api?action=complete_task` - Mark task complete (requires auth)
- `POST /api?action=uncomplete_task` - Uncomplete task (requires auth)
- `POST /api?action=daily_reset` - Update daily reset timestamp (requires auth)

### AI Services (New)
- `POST /api/ai/parse-task` - Parse task input with AI (requires auth)
- `POST /api/ai/daily-motivation` - Get daily motivation (requires auth)
- `POST /api/ai/daily-plan` - Generate daily plan (requires auth)
- `POST /api/ai/client-followup` - Generate client follow-up (requires auth)

All AI endpoints accept optional `provider` parameter (`openai` or `deepseek`), defaulting to `openai`.

## Deployment on Coolify

1. **Create PostgreSQL Resource:**
   - In Coolify, go to Resources > New Resource > Databases > PostgreSQL
   - Copy the connection string

2. **Deploy Backend:**
   - Create a new Application resource
   - Connect your Git repository
   - Set the root directory to `backend/`
   - Coolify will auto-detect Node.js

3. **Configure Environment Variables:**
   - Add all variables from `.env.example`
   - Use the PostgreSQL connection string from step 1
   - Set `CORS_ORIGIN` to your Netlify frontend URL

4. **Set FQDN:**
   - Configure your domain (e.g., `api.yourdomain.com`)
   - Coolify will handle SSL automatically

## Database Schema

See `schema.sql` for the complete database schema.

### Tables
- `users`: User accounts with gamification stats
- `tasks`: User tasks with metadata and AI-generated fields

## Project Structure

```
backend/
├── src/
│   ├── config/        # Configuration files
│   ├── middleware/    # Express middleware
│   ├── routes/        # API route handlers
│   ├── services/      # Business logic
│   ├── utils/         # Utility functions
│   └── server.js      # Main server file
├── schema.sql         # Database schema
├── package.json       # Dependencies
└── .env.example       # Environment variables template
```

## License

MIT
