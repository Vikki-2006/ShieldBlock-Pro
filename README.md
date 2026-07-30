# ShieldBlock Pro

> **A professional, Manifest V3 ad blocker for Chrome, Brave, and Edge.**

![ShieldBlock Pro](assets/icons/icon128.png)

---

## Features

- **Network-level blocking** via `declarativeNetRequest` — 80 bundled rules targeting major ad networks and trackers
- **Cosmetic filtering** — 50+ CSS selectors to hide cookie banners, ad slots, newsletter popups, and floating ads
- **URL cleaner** — strips 30+ tracking parameters (UTM, fbclid, gclid, etc.) without page reload
- **Popup blocker** — overrides `window.open` in the MAIN world to block ad popups
- **Live statistics** — per-tab badge counter, persistent aggregate totals, 30-day history
- **Custom rules** — EasyList-compatible rule import and manual entry
- **Whitelist** — permanent and temporary (per-session) site exceptions
- **Beautiful UI** — dark glassmorphism popup, full settings page, statistics dashboard

---

## Project Structure

```
shieldblock-pro/
├── manifest.json              ← MV3 manifest
├── background/
│   ├── index.js               ← Service worker entry (all listeners registered top-level)
│   ├── MessageRouter.js       ← Typed message bus handler
│   ├── RuleEngine.js          ← DNR rule management (static + dynamic + session)
│   ├── RuleIDRegistry.js      ← Persistent rule ID allocator (prevents collisions)
│   ├── FilterParser.js        ← EasyList-compatible rule parser
│   ├── WhitelistManager.js    ← Whitelist with in-memory cache
│   ├── StatsEngine.js         ← Dual-layer stats (session + persistent)
│   ├── BadgeManager.js        ← Debounced badge updates
│   ├── AlarmManager.js        ← Daily reset scheduler
│   └── ContextMenuManager.js  ← Right-click menu
├── content/
│   ├── index.js               ← Content coordinator (ISOLATED world)
│   ├── CosmeticEngine.js      ← CSS injection + MutationObserver
│   ├── PopupBlocker.js        ← window.open override (MAIN world)
│   ├── AntiRedirect.js        ← URL tracking param cleaner
│   └── ResourceObserver.js    ← PerformanceResourceTiming-based stat reporter
├── shared/
│   ├── constants.js           ← All constants (single source of truth)
│   ├── messages.js            ← Typed message bus
│   ├── storage.js             ← Storage abstraction with schema migration
│   ├── utils.js               ← Pure utility functions
│   ├── validator.js           ← Input validation
│   └── logger.js              ← Structured logging with error persistence
├── popup/
│   ├── index.html
│   ├── popup.css
│   └── index.js
├── options/
│   ├── index.html
│   ├── options.css
│   └── index.js
├── dashboard/
│   ├── index.html
│   ├── dashboard.css
│   └── index.js
├── rules/
│   ├── static_rules.json      ← 50 ad network rules
│   └── privacy_rules.json     ← 30 tracker/analytics rules
└── assets/
    └── icons/
```

---

## Installation (Developer Mode)

1. Open Chrome/Brave/Edge and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `Ad Blocker Extension` folder (this directory)
5. The ShieldBlock Pro icon appears in your toolbar

---

## Architecture Decisions

### Manifest V3 Compliance
- All event listeners registered **synchronously at top level** — avoids MV3's ephemeral service worker pitfall
- No `webRequest` API — uses `declarativeNetRequest` exclusively
- Session state via `chrome.storage.session`, persistent state via `chrome.storage.local`

### Rule ID Registry
- Persistent `RuleIDRegistry` allocates unique integers per partition to prevent ID collisions across service worker restarts
- Partitions: `SESSION_WHITELIST` (1–999), `CUSTOM_USER_RULES` (1000–9999)

### Dual-Layer Statistics
- **Session layer** (`chrome.storage.session`): per-tab ephemeral counters, cleared on browser restart
- **Persistent layer** (`chrome.storage.local`): aggregate totals + 30-day history ring buffer

### Content Script Architecture
- **ISOLATED world** scripts: `index.js`, `CosmeticEngine.js`, `AntiRedirect.js`, `ResourceObserver.js` — can access `chrome.*` APIs
- **MAIN world** script: `PopupBlocker.js` — has access to real `window.open` for effective popup blocking

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+B` | Toggle ShieldBlock Pro on/off |
| `Alt+Shift+P` | Pause blocking on current site |
| `Alt+Shift+D` | Open Dashboard |

---

## Permissions

| Permission | Reason |
|---|---|
| `declarativeNetRequest` | Block network requests |
| `declarativeNetRequestFeedback` | Read matched rule stats |
| `storage` | Persist settings and stats |
| `tabs` | Get current tab URL |
| `activeTab` | Access current tab info |
| `webNavigation` | Reset badge on page load |
| `scripting` | Inject content scripts |
| `alarms` | Daily stats reset |
| `contextMenus` | Right-click menu items |
| `notifications` | (optional) Block alerts |

---

## License

MIT License — see [LICENSE](LICENSE)
