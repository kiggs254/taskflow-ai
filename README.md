# TASKFLOW.AI 🧠⚡

**TASKFLOW.AI** is a neuro-friendly, gamified task management system specifically designed for software developers. It combines traditional productivity tools with RPG-like progression and AI-powered automation to help manage cognitive load and maintain developer "flow".

![TaskFlow Hero](https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=1200)

---

## 🚀 Key Features

### 🎮 Gamified Productivity
- **XP & Leveling System**: Earn 50 XP for every task completed. Level up as you crush your goals.
- **Activity Streaks**: Track your daily consistency with the dynamic streak counter.
- **Victory Fanfares**: Auditory and visual celebrations when you finish tasks or level up.

### 🤖 AI-Powered Intelligence (Powered by Gemini)
- **Natural Language Parsing**: Just type "Finish that API bug tomorrow 20m high energy" and let AI categorize it.
- **Dopamine Boosts**: Personalized daily motivation based on your actual progress.
- **Strategic Daily Planning**: AI-generated bullet points each evening to help you tackle the next day's workload without burnout.
- **Freelance Client Drafts**: Automatically generate professional follow-up messages for freelance tasks.

### 🛠 Deep Work Engineering
- **Focus Mode**: A minimalist, distraction-free view with an integrated Pomodoro-style timer.
- **Energy-Based Labeling**: Categorize tasks by cognitive load (High, Medium, Low) to match your brain's current state.
- **Dependency Tracking**: Link tasks together to see what's blocking you.
- **Snooze & Waiting Status**: Keep your list clean by snoozing tasks or marking them as "Waiting" for external input.

### 🏢 Workspace Isolation
- Separate your brain between **Job**, **Freelance**, and **Personal** projects with dedicated workspace filters.

---

## 🛠 Tech Stack

- **Frontend**: 
  - [React 19](https://react.dev/) - Modern component architecture.
  - [Vite](https://vitejs.dev/) - Blazing fast build tool.
  - [Tailwind CSS](https://tailwindcss.com/) - Utility-first styling (via CDN).
  - [Lucide React](https://lucide.dev/) - Beautiful, consistent iconography.
- **Backend**:
  - [PHP 8.x](https://www.php.net/) - Lightweight API layer.
  - [MySQL](https://www.mysql.com/) - Persistent storage for tasks and user data.
- **AI**:
  - [Google Gemini 2.0 Flash](https://ai.google.dev/) - High-speed, high-intelligence LLM.

---

## 📦 Installation & Setup

### 1. Frontend Setup
```bash
# Clone the repository
git clone https://github.com/your-repo/taskflow.ai.git

# Navigate to the project
cd taskflow.ai

# Install dependencies
npm install

# Start the development server
npm run dev
```

### 2. Backend Setup
1. Upload `api.php` to your PHP-enabled server.
2. Create a MySQL database and update the credentials in `api.php`:
   ```php
   $host = "localhost";
   $user = "your_db_user";
   $pass = "your_db_pass";
   $db   = "your_db_name";
   ```
3. Update the `API_BASE` URL in `services/apiService.ts` to point to your hosted `api.php`.

### 3. Environment Variables
Create a `.env.local` file in the root directory:
```env
GEMINI_API_KEY=your_google_gemini_api_key_here
```

---

## 🗃 Database Schema

The backend expects the following tables:

### `users`
- `id` (INT, Primary Key, Auto Increment)
- `username` (VARCHAR)
- `email` (VARCHAR, Unique)
- `password_hash` (VARCHAR)
- `xp` (INT, default 0)
- `level` (INT, default 1)
- `streak` (INT, default 0)
- `last_active_date` (DATE)
- `last_reset_at` (DATETIME)

### `tasks`
- `id` (VARCHAR, Primary Key)
- `user_id` (INT)
- `title` (TEXT)
- `workspace` (VARCHAR)
- `energy` (VARCHAR)
- `status` (VARCHAR)
- `estimated_time` (INT)
- `tags` (JSON)
- `dependencies` (JSON)
- `recurrence` (JSON)
- `created_at` (BIGINT)
- `completed_at` (BIGINT, NULL)
- `due_date` (BIGINT, NULL)
- `snoozed_until` (BIGINT, NULL)

---

## 📜 License
MIT License - Developed with ❤️ for flow-state enthusiasts.
