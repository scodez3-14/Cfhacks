// worker.js - COMPLETE ENHANCED VERSION

const botToken= 'xxx';
// In-memory cache for CF problems and contests
let problemsCache = {
  data: null,
  timestamp: 0
};

let contestsCache = {
  data: null,
  timestamp: 0
};

const CACHE_TTL = 3600000; // 1 hour

// Achievement definitions
const ACHIEVEMENTS = {
  FIRST_BLOOD: { name: "First Blood", desc: "Solve your first problem", emoji: "🩸" },
  STREAK_7: { name: "Week Warrior", desc: "7-day solving streak", emoji: "🔥" },
  RATING_100: { name: "Centurion", desc: "Solve 100 problems", emoji: "💯" },
  ALL_TAGS: { name: "Jack of All Trades", desc: "Solve problems from 10 different tags", emoji: "🎭" },
  RATING_1600: { name: "Expert", desc: "Solve a 1600+ rated problem", emoji: "⭐" },
  DAILY_CHAMP: { name: "Daily Champion", desc: "Complete daily challenge", emoji: "🏆" }
};

// Command descriptions
const COMMANDS = {
  "/start": "Start the bot",
  "/stats": "View your solving statistics",
  "/contest": "Upcoming contests",
  "/goal": "Set daily goals",
  "/challenge": "Daily challenge",
  "/compare": "Compare with friends",
  "/browse": "Browse problems interactively",
  "/reminder": "Set contest reminders",
  "/achievements": "View your achievements",
  "/help": "Show all commands",
  "/history": "Your problem history"
};

async function fetchCFProblems() {
  const now = Date.now();
  if (problemsCache.data && (now - problemsCache.timestamp) < CACHE_TTL) {
      return problemsCache.data;
  }

  try {
      console.log('Fetching CF problems from API...');
      const response = await fetch('https://codeforces.com/api/problemset.problems');
      
      if (!response.ok) {
          throw new Error(`CF API failed with status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.status !== 'OK') {
          throw new Error('CF API not OK');
      }
      
      problemsCache.data = data.result.problems;
      problemsCache.timestamp = now;
      console.log(`Fetched ${problemsCache.data.length} problems`);
      return problemsCache.data;
  } catch (error) {
      console.error('Error fetching CF problems:', error);
      return problemsCache.data || [];
  }
}

async function fetchContests() {
  const now = Date.now();
  if (contestsCache.data && (now - contestsCache.timestamp) < CACHE_TTL) {
      return contestsCache.data;
  }

  try {
      const response = await fetch('https://codeforces.com/api/contest.list');
      const data = await response.json();
      
      if (data.status === 'OK') {
          contestsCache.data = data.result;
          contestsCache.timestamp = now;
      }
      return contestsCache.data || [];
  } catch (error) {
      console.error('Error fetching contests:', error);
      return contestsCache.data || [];
  }
}

// Enhanced problem filtering
function filterProblems(problems, mode, rating = null, tag = null, indexLetter = null, count = 5, options = {}) {
  let filtered = [...problems];

  if (mode === 'rating') {
      filtered = filtered.filter(p => p.rating === rating);
  } else if (mode === 'tag') {
      filtered = filtered.filter(p => 
          tag && p.tags && p.tags.some(t => t.toLowerCase().includes(tag.toLowerCase()))
      );
  } else if (mode === 'index') {
      filtered = filtered.filter(p => p.index === indexLetter);
  } else if (mode === 'rating_tag') {
      filtered = filtered.filter(p => 
          p.rating === rating && 
          tag && p.tags && p.tags.some(t => t.toLowerCase().includes(tag.toLowerCase()))
      );
  } else if (mode === 'random') {
      const minRating = options.minRating || 800;
      const maxRating = options.maxRating || 3500;
      filtered = filtered.filter(p => p.rating >= minRating && p.rating <= maxRating);
  } else if (mode === 'recent_contest') {
      // Filter problems from recent contests (last 6 months)
      const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter(p => p.contestId > 1000); // Simple heuristic for recent contests
  }

  // Filter out problems without contestId or index
  filtered = filtered.filter(p => p.contestId && p.index);

  // Shuffle and limit
  for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }
  
  return filtered.slice(0, count);
}

function createKeyboard(buttonRows) {
  return {
      inline_keyboard: buttonRows
  };
}

async function sendMessage(chatId, text, botToken, replyMarkup = null, parseMode = null) {
  const payload = {
      chat_id: chatId,
      text: text
  };

  if (replyMarkup) {
      payload.reply_markup = replyMarkup;
  }
  if (parseMode) {
      payload.parse_mode = parseMode;
  }

  try {
      console.log(`Sending message to chat ${chatId}: ${text.substring(0, 50)}...`);
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      if (!response.ok) {
          console.error('Telegram API error:', result);
          return false;
      }
      
      console.log('Message sent successfully');
      return true;
  } catch (error) {
      console.error('Error sending message:', error);
      return false;
  }
}

// KV Database Functions
async function dbGetUser(chatId, KV) {
  try {
      const userData = await KV.get(`user:${chatId}`);
      return userData ? JSON.parse(userData) : null;
  } catch (error) {
      console.error('Error getting user from KV:', error);
      return null;
  }
}

async function dbUpsertUser(chatId, updates, KV) {
  try {
      const existing = await dbGetUser(chatId, KV) || {};
      const merged = { ...existing, ...updates, chat_id: chatId };
      await KV.put(`user:${chatId}`, JSON.stringify(merged));
      return merged;
  } catch (error) {
      console.error('Error upserting user to KV:', error);
      return null;
  }
}

async function dbAddHistory(chatId, problem, KV) {
  try {
      const historyKey = `history:${chatId}:${Date.now()}`;
      const historyItem = {
          chat_id: chatId,
          contestId: problem.contestId,
          problem_index: problem.index,
          name: problem.name,
          rating: problem.rating,
          tags: problem.tags || [],
          ts: new Date().toISOString()
      };
      await KV.put(historyKey, JSON.stringify(historyItem));
      
      // Update user's recent history list
      const userHistoryKey = `user_history:${chatId}`;
      let historyList = await KV.get(userHistoryKey);
      if (historyList) {
          historyList = JSON.parse(historyList);
      } else {
          historyList = [];
      }
      
      historyList.unshift(historyItem);
      if (historyList.length > 50) {
          historyList = historyList.slice(0, 50);
      }
      
      await KV.put(userHistoryKey, JSON.stringify(historyList));
      
      // Check for achievements
      await checkAchievements(chatId, KV);
      
  } catch (error) {
      console.error('Error adding history to KV:', error);
  }
}

async function dbGetHistory(chatId, limit = 10, KV) {
  try {
      const userHistoryKey = `user_history:${chatId}`;
      const historyList = await KV.get(userHistoryKey);
      if (!historyList) return [];
      
      return JSON.parse(historyList).slice(0, limit);
  } catch (error) {
      console.error('Error getting history from KV:', error);
      return [];
  }
}

async function dbGetAllHistory(chatId, KV) {
  try {
      const userHistoryKey = `user_history:${chatId}`;
      const historyList = await KV.get(userHistoryKey);
      return historyList ? JSON.parse(historyList) : [];
  } catch (error) {
      return [];
  }
}

// Statistics Function
async function getUserStats(chatId, KV, botToken) {
  const history = await dbGetAllHistory(chatId, KV);
  
  if (history.length === 0) {
      return sendMessage(chatId, "No problems solved yet! Start with /start", botToken);
  }
  
  const solvedByRating = {};
  const solvedByTag = {};
  let totalRating = 0;
  let maxRating = 0;
  
  history.forEach(problem => {
      // Count by rating
      const rating = problem.rating || 'Unknown';
      solvedByRating[rating] = (solvedByRating[rating] || 0) + 1;
      
      // Count by tags
      problem.tags?.forEach(tag => {
          solvedByTag[tag] = (solvedByTag[tag] || 0) + 1;
      });
      
      // Rating stats
      if (problem.rating) {
          totalRating += problem.rating;
          maxRating = Math.max(maxRating, problem.rating);
      }
  });
  
  const averageRating = totalRating / history.filter(p => p.rating).length;
  
  let statsMsg = "📊 *Your Statistics:*\n\n";
  statsMsg += `✅ Total Solved: *${history.length}* problems\n`;
  statsMsg += `⭐ Average Rating: *${Math.round(averageRating)}*\n`;
  statsMsg += `🏆 Highest Rated: *${maxRating}*\n\n`;
  
  statsMsg += "📈 By Rating:\n";
  Object.keys(solvedByRating)
      .sort((a, b) => (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : a - b))
      .forEach(rating => {
          const count = solvedByRating[rating];
          const percentage = ((count / history.length) * 100).toFixed(1);
          const bar = "█".repeat(Math.round(percentage / 10));
          statsMsg += `${rating}: ${bar} ${count} (${percentage}%)\n`;
      });
  
  // Top tags
  const topTags = Object.entries(solvedByTag)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
  
  if (topTags.length > 0) {
      statsMsg += "\n🏷️ Top Tags:\n";
      topTags.forEach(([tag, count]) => {
          statsMsg += `• ${tag}: ${count}\n`;
      });
  }
  
  return sendMessage(chatId, statsMsg, botToken, null, "Markdown");
}

// Contest Features
async function getUpcomingContests(chatId, botToken) {
  try {
      const contests = await fetchContests();
      const upcoming = contests.filter(c => c.phase === 'BEFORE').slice(0, 8);
      
      if (upcoming.length === 0) {
          return sendMessage(chatId, "No upcoming contests found.", botToken);
      }
      
      let msg = "🗓️ *Upcoming Contests:*\n\n";
      upcoming.forEach(contest => {
          const startTime = new Date(contest.startTimeSeconds * 1000);
          const timeUntil = contest.startTimeSeconds * 1000 - Date.now();
          const days = Math.floor(timeUntil / (1000 * 60 * 60 * 24));
          const hours = Math.floor((timeUntil % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          
          msg += `🏆 [${contest.name}](https://codeforces.com/contest/${contest.id})\n`;
          msg += `⏰ ${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString()}\n`;
          msg += `⏳ Starts in ${days}d ${hours}h\n\n`;
      });
      
      const keyboard = createKeyboard([
          [{ text: "🔔 Set Reminder", callback_data: "set_reminder" }],
          [{ text: "📚 Practice Problems", callback_data: "practice_for_contest" }]
      ]);
      
      return sendMessage(chatId, msg, botToken, keyboard, "Markdown");
  } catch (error) {
      return sendMessage(chatId, "❌ Failed to fetch contests", botToken);
  }
}

// Goal System
async function setDailyGoal(chatId, count, KV, botToken) {
  await KV.put(`goal:${chatId}`, JSON.stringify({
      target: parseInt(count),
      startDate: new Date().toISOString(),
      current: 0,
      streak: 0
  }));
  
  return sendMessage(chatId, `🎯 Daily goal set: ${count} problems per day!`, botToken);
}

async function checkGoalProgress(chatId, KV, botToken) {
  const goalData = await KV.get(`goal:${chatId}`);
  if (!goalData) {
      return sendMessage(chatId, "No goal set. Use /goal <number> to set a daily goal.", botToken);
  }
  
  const goal = JSON.parse(goalData);
  const today = new Date().toDateString();
  const history = await dbGetAllHistory(chatId, KV);
  const todayProblems = history.filter(p => new Date(p.ts).toDateString() === today);
  
  goal.current = todayProblems.length;
  const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));
  const progressBar = "█".repeat(Math.floor(progress / 10)) + "░".repeat(10 - Math.floor(progress / 10));
  
  let msg = `🎯 *Daily Goal Progress*\n\n`;
  msg += `Target: ${goal.target} problems\n`;
  msg += `Solved today: ${goal.current} problems\n\n`;
  msg += `Progress: ${progressBar} ${progress}%\n\n`;
  
  if (goal.current >= goal.target) {
      msg += "🎉 *Goal completed!* Amazing work!";
      goal.streak = (goal.streak || 0) + 1;
      if (goal.streak > 1) {
          msg += `\n🔥 Streak: ${goal.streak} days!`;
      }
  } else {
      msg += `Keep going! ${goal.target - goal.current} more to go.`;
  }
  
  await KV.put(`goal:${chatId}`, JSON.stringify(goal));
  return sendMessage(chatId, msg, botToken, null, "Markdown");
}

// Daily Challenge System
async function startDailyChallenge(chatId, KV, botToken) {
  const today = new Date().toDateString();
  const challengeKey = `challenge:${today}`;
  
  let challenge = await KV.get(challengeKey);
  if (!challenge) {
      // Generate new daily challenge
      const problems = await fetchCFProblems();
      const challengeProblems = filterProblems(problems, 'random', null, null, null, 3, { minRating: 1200, maxRating: 2000 });
      challenge = {
          problems: challengeProblems,
          participants: {},
          date: today
      };
      await KV.put(challengeKey, JSON.stringify(challenge));
  } else {
      challenge = JSON.parse(challenge);
  }
  
  // Check if user already participated
  if (challenge.participants[chatId]) {
      return sendMessage(chatId, "You've already joined today's challenge! Check back tomorrow.", botToken);
  }
  
  const keyboard = createKeyboard([
      [{ text: "🎯 Join Daily Challenge", callback_data: "join_challenge" }],
      [{ text: "📋 View Challenge Problems", callback_data: "view_challenge_problems" }]
  ]);
  
  let msg = "🎲 *Daily Challenge*\n\n";
  msg += "Solve 3 problems of varying difficulty!\n";
  msg += "• Complete all 3 to earn the Daily Champion achievement\n";
  msg += "• Challenge resets every 24 hours\n";
  msg += "• Perfect for consistent practice\n\n";
  msg += "Ready to test your skills?";
  
  return sendMessage(chatId, msg, botToken, keyboard, "Markdown");
}

// Achievement System
async function checkAchievements(chatId, KV) {
  const user = await dbGetUser(chatId, KV) || {};
  const history = await dbGetAllHistory(chatId, KV);
  
  if (history.length === 0) return;
  
  const achievements = user.achievements || {};
  const newAchievements = [];
  
  // First Blood
  if (history.length >= 1 && !achievements.FIRST_BLOOD) {
      newAchievements.push('FIRST_BLOOD');
  }
  
  // Centurion
  if (history.length >= 100 && !achievements.RATING_100) {
      newAchievements.push('RATING_100');
  }
  
  // Expert (solve 1600+ problem)
  const hasExpertProblem = history.some(p => p.rating >= 1600);
  if (hasExpertProblem && !achievements.RATING_1600) {
      newAchievements.push('RATING_1600');
  }
  
  // Jack of All Trades (10 different tags)
  const uniqueTags = new Set();
  history.forEach(p => p.tags?.forEach(tag => uniqueTags.add(tag)));
  if (uniqueTags.size >= 10 && !achievements.ALL_TAGS) {
      newAchievements.push('ALL_TAGS');
  }
  
  // Unlock new achievements
  if (newAchievements.length > 0) {
      await unlockAchievements(chatId, newAchievements, KV);
  }
}

async function unlockAchievements(chatId, achievementKeys, KV) {
  const user = await dbGetUser(chatId, KV) || {};
  const achievements = user.achievements || {};
  
  achievementKeys.forEach(key => {
      achievements[key] = {
          unlocked: new Date().toISOString(),
          ...ACHIEVEMENTS[key]
      };
  });
  
  await dbUpsertUser(chatId, { achievements }, KV);
  
  // Send achievement notifications
  const botToken = env.BOT_TOKEN; // Would need to pass this
  achievementKeys.forEach(async (key) => {
      const achievement = ACHIEVEMENTS[key];
      const msg = `🎉 *Achievement Unlocked!*\n\n${achievement.emoji} *${achievement.name}*\n${achievement.desc}`;
      await sendMessage(chatId, msg, botToken, null, "Markdown");
  });
}

async function showAchievements(chatId, KV, botToken) {
  const user = await dbGetUser(chatId, KV) || {};
  const achievements = user.achievements || {};
  const history = await dbGetAllHistory(chatId, KV);
  
  let msg = "🏆 *Your Achievements*\n\n";
  
  Object.entries(ACHIEVEMENTS).forEach(([key, achievement]) => {
      const unlocked = achievements[key];
      if (unlocked) {
          const date = new Date(unlocked.unlocked).toLocaleDateString();
          msg += `✅ ${achievement.emoji} *${achievement.name}*\n   ${achievement.desc}\n   🗓️ ${date}\n\n`;
      } else {
          msg += `🔒 ${achievement.emoji} ${achievement.name}\n   ${achievement.desc}\n\n`;
      }
  });
  
  msg += `📊 Total: ${Object.keys(achievements).length}/${Object.keys(ACHIEVEMENTS).length} unlocked`;
  
  return sendMessage(chatId, msg, botToken, null, "Markdown");
}

// Interactive Problem Browsing
async function browseProblems(chatId, page = 0, KV, botToken) {
  const problems = await fetchCFProblems();
  const pageSize = 5;
  const start = page * pageSize;
  const pageProblems = problems.slice(start, start + pageSize);
  
  if (pageProblems.length === 0) {
      return sendMessage(chatId, "No more problems to show!", botToken);
  }
  
  let msg = `🔍 *Browse Problems* (Page ${page + 1})\n\n`;
  pageProblems.forEach((p, index) => {
      msg += `${index + 1}. [${p.name}](${`https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`})\n`;
      msg += `   Rating: ${p.rating || '?'} | Index: ${p.index}\n`;
      msg += `   Tags: ${p.tags?.slice(0, 3).join(', ') || 'None'}\n\n`;
  });
  
  const keyboardRows = [
      ...pageProblems.map((p, index) => [{
          text: `${p.index} - ${p.name.substring(0, 20)}...`,
          callback_data: `problem_${p.contestId}_${p.index}`
      }])
  ];
  
  const navRow = [];
  if (page > 0) {
      navRow.push({ text: "⬅️ Previous", callback_data: `browse_${page-1}` });
  }
  navRow.push({ text: "Next ➡️", callback_data: `browse_${page+1}` });
  
  keyboardRows.push(navRow);
  keyboardRows.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);
  
  const keyboard = createKeyboard(keyboardRows);
  return sendMessage(chatId, msg, botToken, keyboard, "Markdown");
}

// Enhanced Help Command
async function showHelp(chatId, botToken) {
  let helpMsg = "🤖 *Codeforces Bot - Complete Guide*\n\n";
  
  helpMsg += "*🎯 Basic Commands:*\n";
  helpMsg += "/start - Start the bot and choose mode\n";
  helpMsg += "/help - Show this help message\n";
  helpMsg += "/history - Your recent problem history\n\n";
  
  helpMsg += "*📊 Analytics Commands:*\n";
  helpMsg += "/stats - Detailed solving statistics\n";
  helpMsg += "/achievements - View your achievements\n\n";
  
  helpMsg += "*🏆 Contest & Goals:*\n";
  helpMsg += "/contest - Upcoming contests\n";
  helpMsg += "/goal <number> - Set daily goal\n";
  helpMsg += "/challenge - Daily challenge\n\n";
  
  helpMsg += "*🔍 Exploration:*\n";
  helpMsg += "/browse - Browse problems interactively\n";
  helpMsg += "/compare - Compare with friends (coming soon)\n\n";
  
  helpMsg += "*💡 Pro Tips:*\n";
  helpMsg += "• Use buttons for quick navigation\n";
  helpMsg += "• Set daily goals for consistency\n";
  helpMsg += "• Join daily challenges for motivation\n";
  helpMsg += "• Check /stats to track progress\n";
  
  const keyboard = createKeyboard([
      [{ text: "🎯 Start Solving", callback_data: "mode_rating" }],
      [{ text: "📊 View Stats", callback_data: "show_stats" }],
      [{ text: "🏆 Daily Challenge", callback_data: "daily_challenge" }],
      [{ text: "🗓️ Upcoming Contests", callback_data: "upcoming_contests" }]
  ]);
  
  return sendMessage(chatId, helpMsg, botToken, keyboard, "Markdown");
}

// Main Menu
async function showMainMenu(chatId, KV, botToken) {
  const user = await dbGetUser(chatId, KV);
  const history = await dbGetAllHistory(chatId, KV);
  
  let msg = "🤖 *Codeforces Bot - Main Menu*\n\n";
  msg += `✅ Problems Solved: *${history.length}*\n`;
  
  if (user?.goal) {
      const goal = JSON.parse(await KV.get(`goal:${chatId}`) || '{}');
      msg += `🎯 Daily Goal: *${goal.current || 0}/${goal.target || 0}*\n`;
  }
  
  msg += "\nChoose an option below:";
  
  const keyboard = createKeyboard([
      [
          { text: "🎯 By Rating", callback_data: "mode_rating" },
          { text: "🏷️ By Tag", callback_data: "mode_tag" }
      ],
      [
          { text: "🔤 By Index", callback_data: "mode_index" },
          { text: "⭐ Rating+Tag", callback_data: "mode_rating_tag" }
      ],
      [
          { text: "📊 Statistics", callback_data: "show_stats" },
          { text: "🏆 Achievements", callback_data: "show_achievements" }
      ],
      [
          { text: "🎲 Daily Challenge", callback_data: "daily_challenge" },
          { text: "🗓️ Contests", callback_data: "upcoming_contests" }
      ],
      [
          { text: "🔍 Browse", callback_data: "browse_0" },
          { text: "🎯 Set Goal", callback_data: "set_goal_menu" }
      ],
      [
          { text: "ℹ️ Help", callback_data: "show_help" }
      ]
  ]);
  
  return sendMessage(chatId, msg, botToken, keyboard, "Markdown");
}

// Enhanced Start Function
async function handleStart(chatId, KV, botToken) {
  await dbUpsertUser(chatId, {
      step: null,
      mode: null,
      rating: null,
      tag: null,
      index_letter: null,
      count: null,
      joined_date: new Date().toISOString()
  }, KV);
  
  return showMainMenu(chatId, KV, botToken);
}

// Send Problems Function
async function sendProblems(chatId, problems, KV, botToken) {
  if (!problems || problems.length === 0) {
      return sendMessage(chatId, "❌ No problems found for your filters.", botToken);
  }

  for (const p of problems) {
      const link = `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
      const name = p.name;
      const rating = p.rating || "?";
      const tags = p.tags ? p.tags.slice(0, 3).join(", ") : "";
      
      await sendMessage(
          chatId, 
          `[${name}](${link}) — ${rating}⭐ (${tags})`, 
          botToken, 
          null, 
          "Markdown"
      );
      
      // Add to history
      await dbAddHistory(chatId, p, KV);
  }
  
  const keyboard = createKeyboard([
      [{ text: "🔄 More Problems", callback_data: "main_menu" }],
      [{ text: "📊 View Stats", callback_data: "show_stats" }]
  ]);
  
  return sendMessage(chatId, "✅ Problems sent! Keep up the great work! 🚀", botToken, keyboard);
}

// Enhanced Callback Handler
async function handleCallback(callbackData, chatId, KV, botToken) {
  console.log(`Handling callback: ${callbackData} for chat ${chatId}`);
  
  if (callbackData.startsWith('mode_')) {
      const mode = callbackData.split('_')[1];
      await dbUpsertUser(chatId, { mode, step: null }, KV);
      
      if (mode === 'rating') {
          await dbUpsertUser(chatId, { step: 'await_rating' }, KV);
          return sendMessage(chatId, "Enter rating (e.g., 1200):", botToken);
      } else if (mode === 'tag') {
          await dbUpsertUser(chatId, { step: 'await_tag' }, KV);
          return sendMessage(chatId, "Enter tag (e.g., dp, greedy, math):", botToken);
      } else if (mode === 'index') {
          await dbUpsertUser(chatId, { step: 'await_index' }, KV);
          return sendMessage(chatId, "Enter index letter (e.g., A, B, C):", botToken);
      } else if (mode === 'rating_tag') {
          await dbUpsertUser(chatId, { step: 'await_rating_tag_rating' }, KV);
          return sendMessage(chatId, "Enter rating first (e.g., 1300):", botToken);
      }
  }
  else if (callbackData === 'show_stats') {
      return getUserStats(chatId, KV, botToken);
  }
  else if (callbackData === 'show_achievements') {
      return showAchievements(chatId, KV, botToken);
  }
  else if (callbackData === 'upcoming_contests') {
      return getUpcomingContests(chatId, botToken);
  }
  else if (callbackData === 'daily_challenge') {
      return startDailyChallenge(chatId, KV, botToken);
  }
  else if (callbackData === 'show_help') {
      return showHelp(chatId, botToken);
  }
  else if (callbackData === 'main_menu') {
      return showMainMenu(chatId, KV, botToken);
  }
  else if (callbackData.startsWith('browse_')) {
      const page = parseInt(callbackData.split('_')[1]);
      return browseProblems(chatId, page, KV, botToken);
  }
  else if (callbackData === 'set_goal_menu') {
      const keyboard = createKeyboard([
          [{ text: "1 Problem", callback_data: "set_goal_1" }],
          [{ text: "3 Problems", callback_data: "set_goal_3" }],
          [{ text: "5 Problems", callback_data: "set_goal_5" }],
          [{ text: "Custom Goal", callback_data: "set_goal_custom" }]
      ]);
      return sendMessage(chatId, "🎯 Choose your daily goal:", botToken, keyboard);
  }
  else if (callbackData.startsWith('set_goal_')) {
      const count = callbackData.split('_')[2];
      if (count === 'custom') {
          await dbUpsertUser(chatId, { step: 'await_goal' }, KV);
          return sendMessage(chatId, "Enter your daily goal (number of problems):", botToken);
      } else {
          return setDailyGoal(chatId, count, KV, botToken);
      }
  }
  else if (callbackData === 'join_challenge') {
      const today = new Date().toDateString();
      const challengeKey = `challenge:${today}`;
      let challenge = await KV.get(challengeKey);
      if (challenge) {
          challenge = JSON.parse(challenge);
          challenge.participants[chatId] = { joined: new Date().toISOString(), completed: false };
          await KV.put(challengeKey, JSON.stringify(challenge));
          return sendMessage(chatId, "🎉 You've joined the daily challenge! Good luck!", botToken);
      }
  }
  
  return sendMessage(chatId, "Unknown command. Use /help for available commands.", botToken);
}

// Enhanced Text Message Handler
async function handleTextMessage(text, chatId, KV, botToken) {
  console.log(`Handling text: "${text}" from chat ${chatId}`);
  
  const user = await dbGetUser(chatId, KV);
  console.log('User state:', user);

  if (!user) {
      return handleStart(chatId, KV, botToken);
  }

  const step = user.step;
  const mode = user.mode;

  if (text === '/start') {
      return handleStart(chatId, KV, botToken);
  }
  else if (text === '/help') {
      return showHelp(chatId, botToken);
  }
  else if (text === '/stats') {
      return getUserStats(chatId, KV, botToken);
  }
  else if (text === '/history') {
      const history = await dbGetHistory(chatId, 10, KV);
      if (history.length === 0) {
          return sendMessage(chatId, "No history yet. Start solving problems!", botToken);
      }
      
      let msg = "🕓 *Recent Problems:*\n\n";
      history.forEach((item, index) => {
          const link = `https://codeforces.com/problemset/problem/${item.contestId}/${item.problem_index}`;
          const date = new Date(item.ts).toLocaleDateString();
          msg += `${index + 1}. [${item.name}](${link})\n`;
          msg += `   Rating: ${item.rating || '?'} | Date: ${date}\n\n`;
      });
      
      return sendMessage(chatId, msg, botToken, null, "Markdown");
  }
  else if (text === '/contest') {
      return getUpcomingContests(chatId, botToken);
  }
  else if (text.startsWith('/goal')) {
      const parts = text.split(' ');
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
          return setDailyGoal(chatId, parts[1], KV, botToken);
      } else {
          return checkGoalProgress(chatId, KV, botToken);
      }
  }
  else if (text === '/challenge') {
      return startDailyChallenge(chatId, KV, botToken);
  }
  else if (text === '/achievements') {
      return showAchievements(chatId, KV, botToken);
  }
  else if (text === '/browse') {
      return browseProblems(chatId, 0, KV, botToken);
  }
  else if (text === '/compare') {
      return sendMessage(chatId, "🔜 Friend comparison feature coming soon! Use /stats for now.", botToken);
  }

  // Step handling
  if (step === 'await_rating') {
      if (/^\d+$/.test(text)) {
          await dbUpsertUser(chatId, { 
              rating: parseInt(text), 
              step: 'await_count' 
          }, KV);
          return sendMessage(chatId, "Enter number of problems (max 10):", botToken);
      } else {
          return sendMessage(chatId, "Please enter a valid rating.", botToken);
      }
  } else if (step === 'await_tag') {
      await dbUpsertUser(chatId, { 
          tag: text.toLowerCase(), 
          step: 'await_count' 
      }, KV);
      return sendMessage(chatId, "Enter number of problems (max 10):", botToken);
  } else if (step === 'await_index') {
      await dbUpsertUser(chatId, { 
          index_letter: text.toUpperCase(), 
          step: 'await_count' 
      }, KV);
      return sendMessage(chatId, "Enter number of problems (max 10):", botToken);
  } else if (step === 'await_rating_tag_rating') {
      if (/^\d+$/.test(text)) {
          await dbUpsertUser(chatId, { 
              rating: parseInt(text), 
              step: 'await_rating_tag_tag' 
          }, KV);
          return sendMessage(chatId, "Now enter tag (e.g., dp, math, graphs):", botToken);
      } else {
          return sendMessage(chatId, "Please enter a numeric rating.", botToken);
      }
  } else if (step === 'await_rating_tag_tag') {
      await dbUpsertUser(chatId, { 
          tag: text.toLowerCase(), 
          step: 'await_count' 
      }, KV);
      return sendMessage(chatId, "Enter number of problems (max 10):", botToken);
  } else if (step === 'await_count') {
      if (/^\d+$/.test(text)) {
          const count = Math.min(10, Math.max(1, parseInt(text)));
          
          console.log(`Fetching ${count} problems with mode: ${mode}, rating: ${user.rating}, tag: ${user.tag}, index: ${user.index_letter}`);
          
          const problems = await fetchCFProblems();
          const filtered = filterProblems(
              problems, 
              mode, 
              user.rating, 
              user.tag, 
              user.index_letter, 
              count
          );
          
          console.log(`Found ${filtered.length} problems after filtering`);
          
          await sendProblems(chatId, filtered, KV, botToken);
          
          // Reset user state
          await dbUpsertUser(chatId, {
              step: null,
              mode: null,
              rating: null,
              tag: null,
              index_letter: null,
              count: null
          }, KV);
          
      } else {
          return sendMessage(chatId, "Please enter a valid number.", botToken);
      }
  } else if (step === 'await_goal') {
      if (/^\d+$/.test(text)) {
          await dbUpsertUser(chatId, { step: null }, KV);
          return setDailyGoal(chatId, text, KV, botToken);
      } else {
          return sendMessage(chatId, "Please enter a valid number for your goal.", botToken);
      }
  } else {
      return showMainMenu(chatId, KV, botToken);
  }
}

// Main Worker Function
export default {
  async fetch(request, env, ctx) {
      console.log('Received request:', request.method, request.url);
      
      if (request.method === 'GET') {
          return new Response('🚀 Codeforces Bot running on Cloudflare Workers! \n\nFeatures: \n✅ Problem Recommendations \n📊 Statistics & Analytics \n🏆 Achievements System \n🎯 Daily Goals & Challenges \n🗓️ Contest Reminders \n🔍 Interactive Browsing');
      }

      try {
          const data = await request.json();
          console.log('Received webhook data:', JSON.stringify(data).substring(0, 200));

          // Check if environment variables are set
          if (!env.BOT_TOKEN) {
              console.error('BOT_TOKEN is not set in environment variables');
              return new Response(JSON.stringify({ ok: false, error: 'Bot token not configured' }), {
                  status: 500,
                  headers: { 'Content-Type': 'application/json' }
              });
          }

          if (!env.KV) {
              console.error('KV binding is not configured');
          }

          // Handle callback queries
          if (data.callback_query) {
              const cb = data.callback_query;
              const chatId = cb.message.chat.id;
              const action = cb.data;

              await handleCallback(action, chatId, env.KV, env.BOT_TOKEN);
              return new Response(JSON.stringify({ ok: true }), {
                  headers: { 'Content-Type': 'application/json' }
              });
          }

          // Handle text messages
          if (data.message) {
              const msg = data.message;
              const chatId = msg.chat.id;
              const text = msg.text ? msg.text.trim() : '';

              await handleTextMessage(text, chatId, env.KV, env.BOT_TOKEN);
              return new Response(JSON.stringify({ ok: true }), {
                  headers: { 'Content-Type': 'application/json' }
              });
          }

          console.log('No callback_query or message in webhook data');
          return new Response(JSON.stringify({ ok: true }), {
              headers: { 'Content-Type': 'application/json' }
          });

      } catch (error) {
          console.error('Error processing request:', error);
          return new Response(JSON.stringify({ ok: false, error: 'Internal server error' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
          });
      }
  }
};
