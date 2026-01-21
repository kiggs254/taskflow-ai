import { query } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateToken } from '../utils/token.js';
import crypto from 'crypto';
import { sendPasswordResetEmail } from './emailService.js';
import { config } from '../config/env.js';

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

/**
 * Request password reset - generates token and sends email
 */
export const requestPasswordReset = async (email) => {
  // Find user by email
  const userResult = await query(
    'SELECT id, username FROM users WHERE email = $1',
    [email]
  );

  if (userResult.rows.length === 0) {
    // Don't reveal if user exists or not (security best practice)
    return { success: true, message: 'If an account exists with this email, a password reset link has been sent.' };
  }

  const user = userResult.rows[0];

  // Generate secure random token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

  // Store token in database
  await query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, resetToken, expiresAt]
  );

  // Build reset URL
  const frontendUrl = config.frontend.url;
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  // Send email
  try {
    await sendPasswordResetEmail(email, resetToken, resetUrl);
    return { success: true, message: 'Password reset email sent successfully.' };
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    // Delete token if email fails
    await query('DELETE FROM password_reset_tokens WHERE token = $1', [resetToken]);
    throw new Error('Failed to send password reset email. Please try again later.');
  }
};

/**
 * Reset password using token
 */
export const resetPassword = async (token, newPassword) => {
  if (!token || !newPassword) {
    throw new Error('Token and new password are required');
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  // Find valid token
  const tokenResult = await query(
    `SELECT prt.user_id, prt.expires_at, prt.used, u.email
     FROM password_reset_tokens prt
     JOIN users u ON prt.user_id = u.id
     WHERE prt.token = $1`,
    [token]
  );

  if (tokenResult.rows.length === 0) {
    throw new Error('Invalid or expired reset token');
  }

  const tokenData = tokenResult.rows[0];

  // Check if token is expired
  if (new Date() > new Date(tokenData.expires_at)) {
    throw new Error('Reset token has expired. Please request a new password reset.');
  }

  // Check if token has already been used
  if (tokenData.used) {
    throw new Error('This reset token has already been used. Please request a new password reset.');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update user password
  await query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, tokenData.user_id]
  );

  // Mark token as used
  await query(
    'UPDATE password_reset_tokens SET used = true WHERE token = $1',
    [token]
  );

  // Delete all other reset tokens for this user (security best practice)
  await query(
    'DELETE FROM password_reset_tokens WHERE user_id = $1 AND token != $2',
    [tokenData.user_id, token]
  );

  return { success: true, message: 'Password reset successfully.' };
};
