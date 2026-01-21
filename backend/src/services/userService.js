import { query } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateToken } from '../utils/token.js';

/**
 * Register a new user
 */
export const registerUser = async (username, email, password) => {
  // Check if user already exists
  const existingUser = await query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existingUser.rows.length > 0) {
    throw new Error('User already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  const result = await query(
    `INSERT INTO users (username, email, password_hash, xp, level, streak)
     VALUES ($1, $2, $3, 0, 1, 0)
     RETURNING id, username, xp, level, streak, last_reset_at`,
    [username, email, passwordHash]
  );

  const user = result.rows[0];
  const token = generateToken(user.id);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      xp: user.xp,
      level: user.level,
      streak: user.streak,
      last_reset_at: user.last_reset_at,
    },
  };
};

/**
 * Login user and update streak
 */
export const loginUser = async (email, password) => {
  const result = await query(
    `SELECT id, username, password_hash, xp, level, streak, last_active_date, last_reset_at
     FROM users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const user = result.rows[0];

  // Check if password_hash exists
  if (!user.password_hash) {
    console.error(`User ${user.id} (${email}) has no password hash`);
    throw new Error('Invalid credentials');
  }

  // Verify password
  try {
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }
  } catch (error) {
    // If password verification fails, log the error but don't expose details
    console.error(`Password verification failed for user ${user.id} (${email}):`, error.message);
    throw new Error('Invalid credentials');
  }

  // Update streak logic
  const today = new Date().toISOString().split('T')[0];
  let newStreak = user.streak;

  if (user.last_active_date !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (user.last_active_date === yesterdayStr) {
      newStreak = user.streak + 1;
    } else {
      newStreak = 1;
    }

    // Update last_active_date and streak
    await query(
      'UPDATE users SET last_active_date = $1, streak = $2 WHERE id = $3',
      [today, newStreak, user.id]
    );
  }

  const token = generateToken(user.id);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      xp: user.xp,
      level: user.level,
      streak: newStreak,
      last_reset_at: user.last_reset_at,
    },
  };
};

/**
 * Update user XP and level
 */
export const updateUserXP = async (userId, xpGain = 50) => {
  const result = await query(
    'UPDATE users SET xp = xp + $1 WHERE id = $2 RETURNING xp, level',
    [xpGain, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const { xp, level } = result.rows[0];
  const newLevel = Math.floor(xp / 500) + 1;
  let leveledUp = false;

  if (newLevel > level) {
    await query('UPDATE users SET level = $1 WHERE id = $2', [
      newLevel,
      userId,
    ]);
    leveledUp = true;
  }

  return {
    new_xp: xp,
    new_level: newLevel,
    leveled_up: leveledUp,
  };
};

/**
 * Update daily reset timestamp
 */
export const updateDailyReset = async (userId) => {
  const now = new Date().toISOString();
  const result = await query(
    'UPDATE users SET last_reset_at = $1 WHERE id = $2 RETURNING last_reset_at',
    [now, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  return {
    success: true,
    reset_time: result.rows[0].last_reset_at,
  };
};

/**
 * Get user preferences
 */
export const getUserPreferences = async (userId) => {
  const result = await query(
    'SELECT show_freelance_tab, show_personal_tab FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const prefs = result.rows[0];
  return {
    showFreelanceTab: prefs.show_freelance_tab || false,
    showPersonalTab: prefs.show_personal_tab || false,
  };
};

/**
 * Update user preferences
 */
export const updateUserPreferences = async (userId, preferences) => {
  const updates = [];
  const values = [];
  let paramCount = 1;

  if (preferences.showFreelanceTab !== undefined) {
    updates.push(`show_freelance_tab = $${paramCount++}`);
    values.push(Boolean(preferences.showFreelanceTab));
  }
  if (preferences.showPersonalTab !== undefined) {
    updates.push(`show_personal_tab = $${paramCount++}`);
    values.push(Boolean(preferences.showPersonalTab));
  }

  if (updates.length === 0) {
    throw new Error('No preferences to update');
  }

  values.push(userId);

  await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount++}`,
    values
  );

  return { success: true };
};
