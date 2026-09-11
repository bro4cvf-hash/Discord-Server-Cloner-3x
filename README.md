# Discord Server Cloner 2x (Web GUI Edition) 🚀

> **A powerful, modern Discord server replicator featuring a sleek Web UI Dashboard, real-time live console, and granular cloning controls.**
> 
> *Enhanced fork of [joaokristani/Discord-Server-Cloner-2x](https://github.com/joaokristani/Discord-Server-Cloner-2x)*

---

## ✨ What's New: Modern Web GUI Dashboard

We upgraded the project from a command-line-only script to a full-featured **Modern Web UI Dashboard**! Now you can easily manage, customize, and monitor the entire cloning process visually in your browser.

### 🖼️ Screenshots

#### 1. Server Browser & Destination Selection
Search and pick your source server visually, and decide whether to create a fresh server, clone into an existing server, or generate an official Discord template.
![Server Browser and Destination Selection](assets/gui-servers.png)

#### 2. Granular Cloning Components
Toggle exactly what elements you want to duplicate before starting:
- **Roles & Colors:** Role hierarchy, hex colors, hoist settings, and member permissions
- **Categories & Channels:** Voice channels, text channels, announcements, topics, and category layouts
- **Channel Permissions:** Synced role view/send permissions and private channel lock states
- **Server Emojis:** Custom static and animated emojis
- **Save Backup JSON:** Automatically exports a backup file to your project directory
- **Message History:** Archive message history per channel
![Cloning Components & Options](assets/gui-options.png)

#### 3. Real-Time Live Execution Console
Watch the live cloning progress with percentage tracking, granular step logs, and instant abort capability.
![Live Progress and Console](assets/gui-progress.png)

---

## ⚡ Features

- 🌐 **Modern Web Dashboard:** Beautiful dark-mode UI accessible at `http://localhost:4567` (opens automatically on launch).
- 🎯 **Visual Server Selector:** Search and browse all servers your account has access to.
- ⚙️ **Customizable Cloning Options:** Selectively clone channels, roles, permissions, emojis, and messages.
- 📊 **Real-time SSE Progress Streaming:** Live execution logs and progress percentage bar.
- 🛑 **Abort Anytime:** Cancel a running clone operation safely with the Abort button.
- 💻 **Dual Mode:** Use either the new **Web GUI** or classic **Terminal CLI**.
- 🛡️ **Rate Limit Protection:** Built-in safeguards and delays to prevent Discord rate limits and bans.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A Discord User Token

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bro4cvf-hash/Discord-Server-Cloner-2x.git
   cd Discord-Server-Cloner-2x
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

---

## 🎮 How to Run

### Method 1: Using `start.bat` (Windows Quick Launch)
Simply double-click `start.bat` or run:
```cmd
start.bat
```
It will automatically check dependencies and ask you whether to launch the **Web Dashboard** (default) or the **Terminal CLI**.

---

### Method 2: Web GUI Dashboard (Recommended)
Run:
```bash
npm start
```
The server will start and automatically open your default browser at:
```
http://localhost:4567
```

---

### Method 3: Classic Terminal CLI
If you prefer running in the terminal without a browser:
```bash
npm run start:cli
```

---

## ⚠️ Disclaimer

This tool uses a Discord user token (`discord.js-selfbot-v13`) to automate cloning operations. Automating user accounts violates the Discord Terms of Service. Use at your own discretion and responsibility.

---

## 🤝 Credits & Acknowledgments

- Original project by [joaokristani](https://github.com/joaokristani/Discord-Server-Cloner-2x).
- Enhanced with Web UI Dashboard, real-time SSE progress tracking, and bug fixes by [bro4cvf-hash](https://github.com/bro4cvf-hash).
