<div align="center">

<img src="assets/logo.png" width="140">

# 🛡️ ShieldBlock Pro

### Professional Manifest V3 Ad Blocker for Chromium Browsers

Fast • Lightweight • Privacy Focused • Open Source

![Chrome](https://img.shields.io/badge/Chrome-Compatible-blue?style=for-the-badge&logo=googlechrome)
![Manifest](https://img.shields.io/badge/Manifest-V3-success?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?style=for-the-badge&logo=javascript)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)

A modern privacy-first browser extension that blocks ads, trackers, popups, cookie banners and cleans tracking URLs while providing real-time statistics.

</div>

---

## ✨ Features

| | |
|---|---|
| 🚫 Network Ad Blocking | Manifest V3 DeclarativeNetRequest |
| 🎨 Cosmetic Filtering | Hide banners, popups & floating ads |
| 🪟 Popup Blocker | Blocks popup windows |
| 🔗 URL Cleaner | Removes tracking parameters |
| 📊 Live Statistics | Per-page & total statistics |
| 🔔 Badge Counter | Real-time blocked request count |
| ✅ Whitelist | Permanent & temporary site exceptions |
| ⚙️ Dashboard | Modern analytics dashboard |
| 🌙 Dark UI | Professional glassmorphism interface |

---

# 📸 Screenshots

## Popup

<p align="center">
<img src="assets/screenshots/popup.png" width="340">
</p>

---

## Dashboard

<p align="center">
<img src="assets/screenshots/dashboard.png">
</p>

---

## Settings

<p align="center">
<img src="assets/screenshots/settings.png">
</p>

---

# ⚡ Performance

✔ Lightweight Manifest V3 architecture

✔ Background Service Worker

✔ Optimized rule engine

✔ Low memory usage

✔ Fast startup

✔ Efficient storage

✔ Modular architecture

---

# 🔒 Privacy

ShieldBlock Pro respects your privacy.

- No telemetry
- No analytics
- No data collection
- No cloud sync
- No tracking
- Everything runs locally

---

# 🏗 Architecture

```
Browser
      │
      ▼
Manifest V3
      │
      ▼
Background Service Worker
      │
      ├── Rule Engine
      ├── Stats Engine
      ├── Badge Manager
      ├── Message Router
      └── Storage
              │
      ┌───────┴────────┐
      ▼                ▼
 Popup UI        Dashboard UI
```

---

# 📂 Project Structure

```text
shieldblock-pro/
│
├── manifest.json
│
├── background/
│   ├── index.js
│   ├── RuleEngine.js
│   ├── StatsEngine.js
│   ├── BadgeManager.js
│   ├── MessageRouter.js
│   └── ...
│
├── content/
│   ├── CosmeticEngine.js
│   ├── PopupBlocker.js
│   ├── AntiRedirect.js
│   └── ...
│
├── popup/
├── dashboard/
├── options/
├── rules/
├── assets/
└── shared/
```

---

# 🛠 Tech Stack

- JavaScript (ES6)
- Manifest V3
- Chrome Extensions API
- DeclarativeNetRequest
- Chrome Storage API
- MutationObserver
- CSS Selectors

---

# 🚀 Installation

```bash
git clone https://github.com/Vikki-2006/ShieldBlock-Pro.git
```

Open Chrome

```
chrome://extensions
```

Enable **Developer Mode**

Click **Load unpacked**

Select the project folder.

Done ✅

---

# 📋 Roadmap

- [ ] More filter lists
- [ ] Custom filters
- [ ] Sync settings
- [ ] Backup & Restore
- [ ] Advanced tracker protection
- [ ] Performance improvements
- [ ] AI-assisted rule suggestions

---

# 🤝 Contributing

Contributions are welcome.

1. Fork
2. Create feature branch
3. Commit
4. Push
5. Open Pull Request

---

# 📜 License

Licensed under the MIT License.

---

<div align="center">

Made with ❤️ by **Vigneshwaran**

⭐ Star this repository if you found it useful.

</div>
