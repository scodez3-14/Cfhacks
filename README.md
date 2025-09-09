# Cfhacks Telegram Bot

This is a Telegram bot that sends random Codeforces problems of a user-specified rating.

## Features
- User can input any Codeforces problem rating.
- User can choose how many problems to receive.
- Bot avoids sending duplicate problems to the same user.

## Setup
1. **Clone the repository:**
   ```bash
   git clone https://github.com/scodez3-14/Cfhacks.git
   cd Cfhacks
   ```
2. **Create a `.env` file:**
   Add your Telegram bot token from BotFather:
   ```
   TOKEN=your_actual_telegram_bot_token
   ```
3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   If you don't have a `requirements.txt`, install manually:
   ```bash
   pip install python-telegram-bot requests python-dotenv
   ```
4. **Run the bot:**
   ```bash
   python main.py
   ```

## Security
- **Never push your `.env` file to a public repository.**
- If you accidentally exposed your token, reset it in BotFather and update your `.env`.

## License
MIT
