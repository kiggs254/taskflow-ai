import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A commit must appear in exactly ONE daily report, never repeated the next day.
 *
 * The regression: an integration day-task (GitHub, agent) is a mutable daily aggregate
 * whose completed_at advances to the latest commit all day. Keyed on completed_at, a
 * task reported at 16:30 re-qualified the next day the moment one more commit extended
 * it -- and the report showed ALL its subtasks, re-sending yesterday's commits. Each
 * subtask's completedAt is the immutable commit time, and the windows partition time,
 * so filtering to in-window subtasks makes every commit land in exactly one report.
 *
 * This pins the selection logic in pure JS; the SQL half is verified against real
 * Postgres separately.
 */

const CLAMP = 7 * 24 * 60 * 60 * 1000;
const at = (day, hour) => Date.UTC(2026, 6, day, hour - 3); // Africa/Nairobi, UTC+3
const midnightOf = (ms) => {
  const d = new Date(ms + 3 * 3600 * 1000);
  return Date.UTC(2026, 6, d.getUTCDate(), -3);
};
const numAt = (s) => {
  const v = s?.completedAt;
  if (typeof v === 'number') return v;
  return /^[0-9]+$/.test(String(v)) ? Number(v) : null;
};

// Mirrors getCompletedToday's per-row selection for a task WITH timestamped subtasks.
const shownSubtasks = (task, since, atMs) => {
  const windowEnd = atMs;
  const windowStart = since ? Math.max(since, atMs - CLAMP) : midnightOf(atMs);
  const timestamped = task.subtasks.filter((s) => s.completed && numAt(s) !== null);
  if (!timestamped.length) return null;
  const inWindow = timestamped.filter((s) => {
    const t = numAt(s);
    return t >= windowStart && t < windowEnd;
  });
  return inWindow.length ? inWindow.map((s) => s.title) : [];
};

const MON_1630 = at(20, 16.5);
const TUE_1630 = at(21, 16.5);

// A hotpoint day-task: 5 commits before the Monday send, 2 after it.
const task = {
  subtasks: [
    { title: 'c1', completed: true, completedAt: at(20, 9) },
    { title: 'c2', completed: true, completedAt: at(20, 10) },
    { title: 'c3', completed: true, completedAt: at(20, 11) },
    { title: 'c4', completed: true, completedAt: at(20, 12) },
    { title: 'c5', completed: true, completedAt: at(20, 13) },
    { title: 'c6', completed: true, completedAt: at(20, 18) }, // after the 16:30 send
    { title: 'c7', completed: true, completedAt: at(20, 19) },
  ],
};

test('the Monday report shows only the commits made before its send', () => {
  assert.deepEqual(shownSubtasks(task, null, MON_1630), ['c1', 'c2', 'c3', 'c4', 'c5']);
});

test('the Tuesday report shows only the after-hours commits, not all seven', () => {
  assert.deepEqual(shownSubtasks(task, MON_1630, TUE_1630), ['c6', 'c7']);
});

test('no commit is reported twice, and none is lost', () => {
  const mon = shownSubtasks(task, null, MON_1630);
  const tue = shownSubtasks(task, MON_1630, TUE_1630);
  assert.deepEqual(mon.filter((c) => tue.includes(c)), [], 'no overlap');
  assert.deepEqual([...mon, ...tue].sort(), task.subtasks.map((s) => s.title).sort(), 'every commit once');
});

test('a fully-reported day-task drops out entirely rather than re-sending', () => {
  // By Wednesday, all of Monday's commits are behind the window.
  const wed = shownSubtasks(task, TUE_1630, at(22, 16.5));
  assert.deepEqual(wed, [], 'nothing new -> the task is skipped, not repeated');
});
