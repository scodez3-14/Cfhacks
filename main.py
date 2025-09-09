from dotenv import load_dotenv
import os

load_dotenv()
import requests
import random
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler
import os

TOKEN = os.getenv("TOKEN")  # make sure TOKEN is set in your environment

# States
ASK_RATING, ASK_COUNT = range(2)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome!\nPlease enter the rating you want (example: 800, 1000, 1200):"
    )
    return ASK_RATING

async def rating(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        rating = int(update.message.text.strip())
        context.user_data['rating'] = rating
        await update.message.reply_text("✅ Got it! Now enter how many questions you want:")
        return ASK_COUNT
    except ValueError:
        await update.message.reply_text("❌ Please enter a valid numeric rating:")
        return ASK_RATING

async def count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        count = int(update.message.text.strip())
        rating = context.user_data['rating']

        # Fetch Codeforces problems
        url = "https://codeforces.com/api/problemset.problems"
        res = requests.get(url).json()
        problems = res["result"]["problems"]

        # Filter by rating
        rated_problems = [p for p in problems if p.get("rating") == rating]

        if not rated_problems:
            await update.message.reply_text(f"⚠️ No problems found for rating {rating}. Try another rating.")
            return ConversationHandler.END

        # Pick random questions
        random.shuffle(rated_problems)
        selected = rated_problems[:count]

        for p in selected:
            link = f"https://codeforces.com/problemset/problem/{p['contestId']}/{p['index']}"
            await update.message.reply_text(f"{p['name']} ({rating})\n{link}")

        return ConversationHandler.END

    except ValueError:
        await update.message.reply_text("❌ Please enter a valid number for question count:")
        return ASK_COUNT

def main():
    app = Application.builder().token(TOKEN).build()
    
    conv_handler = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            ASK_RATING: [MessageHandler(filters.TEXT & ~filters.COMMAND, rating)],
            ASK_COUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, count)],
        },
        fallbacks=[]
    )
    
    app.add_handler(conv_handler)
    app.run_polling()

if __name__ == "__main__":
    main()
