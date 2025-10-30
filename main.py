import os
import sqlite3
import requests
import random
import time
import threading
from flask import Flask, request, jsonify
from dotenv import load_dotenv
load_dotenv()


BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError("Set BOT_TOKEN environment variable")
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}/"

app = Flask(__name__)
DB_PATH = "botdata.db"

# ---------------- Database ----------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS users (
                    chat_id INTEGER PRIMARY KEY,
                    step TEXT,
                    mode TEXT,
                    rating INTEGER,
                    tag TEXT,
                    index_letter TEXT,
                    count INTEGER
                )""")
    c.execute("""CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER,
                    contestId INTEGER,
                    problem_index TEXT,
                    name TEXT,
                    rating INTEGER,
                    ts DATETIME DEFAULT CURRENT_TIMESTAMP
                )""")
    conn.commit()
    conn.close()

def db_get_user(chat_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT chat_id,step,mode,rating,tag,index_letter,count FROM users WHERE chat_id=?", (chat_id,))
    row = c.fetchone()
    conn.close()
    if row:
        keys = ["chat_id","step","mode","rating","tag","index_letter","count"]
        return dict(zip(keys,row))
    return None

def db_upsert_user(chat_id, **kwargs):
    u = db_get_user(chat_id)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if u is None:
        vals = (chat_id, kwargs.get("step"), kwargs.get("mode"),
                kwargs.get("rating"), kwargs.get("tag"),
                kwargs.get("index_letter"), kwargs.get("count"))
        c.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)", vals)
    else:
        fields, vals = [], []
        for k,v in kwargs.items():
            fields.append(f"{k}=?")
            vals.append(v)
        vals.append(chat_id)
        c.execute(f"UPDATE users SET {', '.join(fields)} WHERE chat_id=?", vals)
    conn.commit()
    conn.close()

def db_add_history(chat_id, p):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO history (chat_id, contestId, problem_index, name, rating) VALUES (?, ?, ?, ?, ?)",
              (chat_id, p["contestId"], p["index"], p["name"], p.get("rating")))
    conn.commit()
    conn.close()

def db_get_history(chat_id, limit=10):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT contestId, problem_index, name, rating, ts FROM history WHERE chat_id=? ORDER BY ts DESC LIMIT ?", (chat_id, limit))
    rows = c.fetchall()
    conn.close()
    return rows

# ---------------- CF Data ----------------
CF_CACHE = {"timestamp": 0, "problems": []}
CF_CACHE_TTL = 3600

def fetch_cf_problems(refresh=False):
    now = time.time()
    if CF_CACHE["problems"] and not refresh and now - CF_CACHE["timestamp"] < CF_CACHE_TTL:
        return CF_CACHE["problems"]
    url = "https://codeforces.com/api/problemset.problems"
    resp = requests.get(url, timeout=15)
    if resp.status_code != 200:
        return []
    j = resp.json()
    if j.get("status") != "OK":
        return []
    CF_CACHE["problems"] = j["result"]["problems"]
    CF_CACHE["timestamp"] = now
    return CF_CACHE["problems"]

def filter_problems(mode, rating=None, tag=None, index_letter=None, count=5):
    problems = fetch_cf_problems()
    filtered = problems

    if mode == "rating":
        filtered = [p for p in problems if p.get("rating") == rating]
    elif mode == "tag":
        filtered = [p for p in problems if tag and tag.lower() in [t.lower() for t in p.get("tags", [])]]
    elif mode == "index":
        filtered = [p for p in problems if p.get("index") == index_letter]
    elif mode == "rating_tag":
        filtered = [p for p in problems if p.get("rating") == rating and tag.lower() in [t.lower() for t in p.get("tags", [])]]

    random.shuffle(filtered)
    return filtered[:count]

# ---------------- Telegram Helpers ----------------
def send_message(chat_id, text, reply_markup=None, parse_mode=None):
    data = {"chat_id": chat_id, "text": text}
    if reply_markup: data["reply_markup"] = reply_markup
    if parse_mode: data["parse_mode"] = parse_mode
    requests.post(TELEGRAM_API + "sendMessage", json=data, timeout=10)

def mk_keyboard(button_rows):
    return {"inline_keyboard": button_rows}

# ---------------- Bot Flows ----------------
def start(chat_id):
    db_upsert_user(chat_id, step=None, mode=None, rating=None, tag=None, index_letter=None)
    kb = mk_keyboard([
        [{"text": "By Rating", "callback_data": "mode_rating"},
         {"text": "By Tag", "callback_data": "mode_tag"}],
        [{"text": "By Index (A/B/C)", "callback_data": "mode_index"},
         {"text": "By Rating + Tag", "callback_data": "mode_rating_tag"}]
    ])
    send_message(chat_id, "🎯 Choose your mode to fetch problems:", reply_markup=kb)

def send_history(chat_id):
    rows = db_get_history(chat_id)
    if not rows:
        send_message(chat_id, "No history yet.")
        return
    msg = "🕓 *Recent Problems:*\n"
    for r in rows:
        cid, idx, name, rating, _ = r
        link = f"https://codeforces.com/problemset/problem/{cid}/{idx}"
        msg += f"[{name}]({link}) — {rating}\n"
    send_message(chat_id, msg, parse_mode="Markdown")

def send_problems(chat_id, problems):
    if not problems:
        send_message(chat_id, "❌ No problems found for your filters.")
        return
    for p in problems:
        link = f"https://codeforces.com/problemset/problem/{p['contestId']}/{p['index']}"
        name = p["name"]
        rating = p.get("rating","?")
        tags = ", ".join(p.get("tags", []))
        send_message(chat_id, f"[{name}]({link}) — {rating}⭐ ({tags})", parse_mode="Markdown")
        db_add_history(chat_id, p)
    send_message(chat_id, "✅ Done!")

# ---------------- Webhook ----------------
@app.route(f"/{BOT_TOKEN}", methods=["POST"])
def webhook():
    data = request.get_json()
    if not data:
        return jsonify(ok=True)

    # Inline callback
    if "callback_query" in data:
        cb = data["callback_query"]
        chat_id = cb["message"]["chat"]["id"]
        action = cb["data"]

        if action.startswith("mode_"):
            mode = action.split("_",1)[1]
            db_upsert_user(chat_id, mode=mode)
            if mode == "rating":
                send_message(chat_id, "Enter rating (e.g., 1200):")
                db_upsert_user(chat_id, step="await_rating")
            elif mode == "tag":
                send_message(chat_id, "Enter tag (e.g., dp, greedy, math):")
                db_upsert_user(chat_id, step="await_tag")
            elif mode == "index":
                send_message(chat_id, "Enter index letter (e.g., A, B, C):")
                db_upsert_user(chat_id, step="await_index")
            elif mode == "rating_tag":
                send_message(chat_id, "Enter rating first (e.g., 1300):")
                db_upsert_user(chat_id, step="await_rating_tag_rating")
        return jsonify(ok=True)

    # Text messages
    if "message" in data:
        msg = data["message"]
        chat_id = msg["chat"]["id"]
        text = msg.get("text", "").strip()
        user = db_get_user(chat_id)

        if not user:
            start(chat_id)
            return jsonify(ok=True)

        step = user.get("step")
        mode = user.get("mode")

        if text == "/start":
            start(chat_id)
            return jsonify(ok=True)
        if text == "/history":
            send_history(chat_id)
            return jsonify(ok=True)

        # ----- Step handling -----
        if step == "await_rating":
            if text.isdigit():
                db_upsert_user(chat_id, rating=int(text), step="await_count")
                send_message(chat_id, "Enter number of problems (max 10):")
            else:
                send_message(chat_id, "Please enter a valid rating.")
        elif step == "await_tag":
            db_upsert_user(chat_id, tag=text.lower(), step="await_count")
            send_message(chat_id, "Enter number of problems (max 10):")
        elif step == "await_index":
            db_upsert_user(chat_id, index_letter=text.upper(), step="await_count")
            send_message(chat_id, "Enter number of problems (max 10):")
        elif step == "await_rating_tag_rating":
            if text.isdigit():
                db_upsert_user(chat_id, rating=int(text), step="await_rating_tag_tag")
                send_message(chat_id, "Now enter tag (e.g., dp, math, graphs):")
            else:
                send_message(chat_id, "Please enter a numeric rating.")
        elif step == "await_rating_tag_tag":
            db_upsert_user(chat_id, tag=text.lower(), step="await_count")
            send_message(chat_id, "Enter number of problems (max 10):")
        elif step == "await_count":
            if text.isdigit():
                count = min(10, max(1, int(text)))
                rating = user.get("rating")
                tag = user.get("tag")
                idx = user.get("index_letter")

                problems = filter_problems(mode, rating, tag, idx, count)
                send_problems(chat_id, problems)
                db_upsert_user(chat_id, step=None, mode=None, rating=None, tag=None, index_letter=None)
            else:
                send_message(chat_id, "Please enter a valid number.")
        else:
            send_message(chat_id, "Use /start to choose a mode again.")
        return jsonify(ok=True)

    return jsonify(ok=True)

# ---------------- Home & Keep Alive ----------------
@app.route("/", methods=["GET"])
def home():
    return "✅ Bot running"


def keep_alive():
    url = os.getenv("SELF_URL")
    if not url:
        print("⚠️ SELF_URL not set")
        return
    while True:
        try:
            requests.get(url, timeout=10)
            print(f"🔄 Pinged {url}")
        except Exception as e:
            print("Ping failed:", e)
        time.sleep(600)


if __name__ == "__main__":
    init_db()
    threading.Thread(target=keep_alive, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
