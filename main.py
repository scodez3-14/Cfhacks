from flask import Flask, request
import os
import asyncio
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler
import requests
import random

# Load environment variables
load_dotenv()

TOKEN = os.getenv("TOKEN")
if not TOKEN:
    raise ValueError("No TOKEN found in environment variables")

# States
ASK_RATING, ASK_COUNT = range(2)

# Initialize Flask app
flask_app = Flask(__name__)

# Initialize Telegram application
application = Application.builder().token(TOKEN).build()

# Handler functions
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome!\nPlease enter the rating you want (e.g., 800, 1000, 1200):"
    )
    return ASK_RATING

async def rating(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        rating = int(update.message.text)
        context.user_data['rating'] = rating
        await update.message.reply_text("✅ Great! Now enter how many questions you want:")
        return ASK_COUNT
    except ValueError:
        await update.message.reply_text("❌ Please enter a valid number for rating:")
        return ASK_RATING

async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        count = int(update.message.text)
        rating = context.user_data['rating']

        # Fetch Codeforces problems
        url = "https://codeforces.com/api/problemset.problems"
        res = requests.get(url).json()
        problems = res["result"]["problems"]

        # Filter by rating
        rated_problems = [p for p in problems if "rating" in p and p["rating"] == rating]

        # Track solved problems for this user
        solved = context.user_data.get('solved', set())
        unsolved_problems = [p for p in rated_problems if (p['contestId'], p['index']) not in solved]

        if not unsolved_problems:
            await update.message.reply_text(f"😢 No new problems found for rating {rating}")
            return ConversationHandler.END

        random.shuffle(unsolved_problems)
        selected = unsolved_problems[:count]

        for p in selected:
            solved.add((p['contestId'], p['index']))
            link = f"https://codeforces.com/problemset/problem/{p['contestId']}/{p['index']}"
            await update.message.reply_text(f"{p['name']} ({rating})\n{link}")

        context.user_data['solved'] = solved
        return ConversationHandler.END

    except ValueError:
        await update.message.reply_text("❌ Please enter a valid number for count:")
        return ASK_COUNT

# 🔹 Reset command
async def reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['solved'] = set()
    await update.message.reply_text("✅ Your solved problems history has been cleared!")

# Add conversation handler
conv_handler = ConversationHandler(
    entry_points=[CommandHandler('start', start)],
    states={
        ASK_RATING: [MessageHandler(filters.TEXT & ~filters.COMMAND, rating)],
        ASK_COUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, count)],
    },
    fallbacks=[]
)

application.add_handler(conv_handler)
application.add_handler(CommandHandler("reset", reset))

# Flask routes
@flask_app.route('/')
def home():
    return "Telegram bot is running!"

@flask_app.route(f'/{TOKEN}', methods=['POST'])
def webhook():
    json_str = request.get_data().decode('UTF-8')
    update = Update.de_json(json_str, application.bot)
    asyncio.run(application.process_update(update))
    return 'ok'

def set_webhook():
    # Set webhook for Telegram
    webhook_url = f"https://cfhacks-2.onrender.com/{TOKEN}"
    asyncio.run(application.bot.set_webhook(webhook_url))

# Initialize webhook when app starts
with flask_app.app_context():
    set_webhook()

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 5000))
    flask_app.run(host='0.0.0.0', port=port)
