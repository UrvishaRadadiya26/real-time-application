# Kaun Banega Crorepati (KBC) "Ask The Audience" Real-Time Poll

A complete, production-ready real-time Audience Poll web application built with **Node.js**, **Express**, and **Socket.io**, faithfully styled with the iconic **Kaun Banega Crorepati (KBC) "Ask the Audience"** lifeline aesthetic.

---

## 🌟 Key Features

### 🖥️ Host / Main Screen (`/host`)
- **Signature KBC Studio Aesthetic**: Deep navy-blue radial gradient, golden metallic accents, beveled frames, and ambient spotlight effects.
- **Host Question Management**:
  - **Edit / New Question Modal**: Host can enter any custom Question and Options A, B, C, D (or select from built-in GK/KBC presets).
  - Displays the Question banner on the big screen and broadcasts real-time text to all audience mobile screens.
- **Dynamic Vertical Bar Graph**:
  - 4 tall vertical columns side-by-side for options **A, B, C, D** with live option names.
  - Smooth CSS height transition animation (`cubic-bezier`) as votes stream in.
  - Floating percentage badges hovering dynamically above each bar (`45%`, `20%`, etc.).
  - Neon LED grid overlay and golden option emblems at the base.
- **Host Control Console**:
  - **Start Poll**: Clears prior counts, sets status to LIVE, and unlocks audience voting.
  - **Lock / Stop Poll**: Freezes current values, changes studio status to AUDIENCE VERDICT, and highlights the winning option.
  - **Reset Poll**: Clears counts to 0 and returns to STANDBY mode without opening poll.
- **Studio Audio Synthesizer**: Built-in Web Audio API generator (zero external MP3 dependencies) reproducing:
  - Suspense countdown clock tick while voting is active.
  - Dramatic lock chime when poll stops.
  - Mute/Unmute audio toggle.
- **Host Security PIN Gate**:
  - The Host screen is password-protected (`Default PIN: 1234`).
  - Unauthorized visitors and audience members cannot open or tamper with the host controls.
  - Sockets must authenticate via `hostLogin` to emit `startPoll`, `stopPoll`, `resetPoll`, or `setQuestion`.
- **Audience QR Code & Link**: Display an on-screen QR code so audience members in the room can scan and join on their mobile phones immediately.
- **Fullscreen Mode**: One-click broadcast projection mode.

### 📱 Audience / Mobile Screen (`/audience` or `/vote`)
- **Mobile-First Responsive Touch Pad**: Optimized for iOS and Android smartphones.
- **State Handling**:
  - **Waiting State**: Animated radar/hourglass pulsating while waiting for the host to unlock the poll.
  - **Active State**: Large tactile buttons with golden badges for **A, B, C, D**.
  - **Voted / Locked State**: Enforces one vote per poll round. Immediately disables buttons upon click, triggers haptic vibration + audio blip, and presents a "Lock Kiya Jaye!" confirmation card showing the selected option.
  - **Closed State**: Informs late participants that voting has ended.

---

## 📁 Project Structure

```
kup-poll/
├── package.json               # Project manifest & dependencies (Express, Socket.io)
├── server.js                  # Express HTTP server, Socket.io handlers, state management
├── README.md                  # Documentation and quick start guide
└── public/
    ├── index.html             # Master launcher portal (Host & Audience links)
    ├── host.html              # Main stage display with animated vertical bars & host controls
    ├── audience.html          # Mobile-first audience voting pad with single-vote lock
    └── css/
        └── kbc-theme.css      # KBC radial gradients, gold borders, bar animation styles
```

---

## ⚡ Socket.io Event Architecture

| Event Name | Direction | Payload | Description |
|------------|-----------|---------|-------------|
| `pollState` | Server ➔ Client | `{ isOpen, question, options, votes, totalVotes, percentages, pollId }` | Emitted immediately when a client connects. |
| `setQuestion` | Host ➔ Server | `{ question, options, startNewPoll }` | Updates question & options text; optionally starts voting immediately. |
| `startPoll` | Host ➔ Server | None | Resets vote counts to 0, unlocks voting (`isOpen = true`), increments poll round ID. |
| `stopPoll` | Host ➔ Server | None | Freezes current vote counts and locks voting (`isOpen = false`). |
| `resetPoll` | Host ➔ Server | None | Resets all counts to 0 without opening poll (`isOpen = false`). |
| `castVote` | Audience ➔ Server | `'A'` \| `'B'` \| `'C'` \| `'D'` | Validates vote, increments count, prevents duplicate votes in the round. |
| `voteConfirmed`| Server ➔ Audience | `{ option, pollId }` | Confirms successful vote recording to the voter. |
| `voteError` | Server ➔ Audience | `{ message }` | Notifies voter if poll is closed or option is invalid. |
| `pollUpdated` | Server ➔ All | `{ isOpen, votes, totalVotes, percentages, pollId, action }` | Broadcasts real-time counts and whole number percentages to all screens. |

---

## 🚀 How to Run

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
Or with auto-reload:
```bash
npm run dev
```

### 3. Open in Browser
- **Portal**: [http://localhost:3000](http://localhost:3000)
- **Host Screen**: [http://localhost:3000/host](http://localhost:3000/host)
- **Audience Voting Screen**: [http://localhost:3000/audience](http://localhost:3000/audience)

> **Tip for Local Network / Multiple Devices**:
> Find your computer's local IP address (e.g., `192.168.1.5`). Mobile phones connected to the same Wi-Fi can navigate to `http://192.168.1.5:3000/audience` or scan the Host screen's QR code to cast live votes!
