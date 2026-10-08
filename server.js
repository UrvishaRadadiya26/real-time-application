const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Host Authentication Credentials
const HOST_USER = process.env.HOST_USER || 'admin';
const HOST_PASS = process.env.HOST_PASS || 'admin123';

// Active Authenticated Tokens & Sockets
const activeHostTokens = new Set();
const authenticatedHostSockets = new Set();

// Express Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Helper to parse cookies from handshake headers
function parseCookie(cookieString) {
  if (!cookieString) return {};
  return cookieString.split(';').reduce((acc, item) => {
    const [key, value] = item.trim().split('=');
    if (key && value) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

// Host Authentication Middleware for Protected Routes
function requireHostAuth(req, res, next) {
  const token = (req.cookies && req.cookies.host_token) || (req.query && req.query.token);
  if (token && activeHostTokens.has(token)) {
    return next();
  }
  return res.redirect('/login');
}

// Protect /host and /host.html before static file serving
app.get(['/host', '/host.html'], requireHostAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Host Login Page Route
app.get('/login', (req, res) => {
  const token = req.cookies && req.cookies.host_token;
  if (token && activeHostTokens.has(token)) {
    return res.redirect('/host');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Host Login API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === HOST_USER && password === HOST_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    activeHostTokens.add(token);

    // Set cookie
    res.cookie('host_token', token, {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax',
      path: '/'
    });

    console.log(`[Auth Success] Host logged in successfully (${username}).`);
    return res.json({ success: true, token, user: username });
  }

  console.log(`[Auth Failed] Failed login attempt for user: "${username}".`);
  return res.status(401).json({ success: false, message: 'Invalid username or password.' });
});

// Host Logout
app.all(['/logout', '/api/logout'], (req, res) => {
  const token = req.cookies && req.cookies.host_token;
  if (token) {
    activeHostTokens.delete(token);
  }
  res.clearCookie('host_token');
  return res.redirect('/login');
});

// Serve static frontend assets from public/ folder (excluding protected files)
app.use(express.static(path.join(__dirname, 'public')));

// Default root directly serves Audience Voting Pad (Audience cannot access host)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

app.get('/audience', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

app.get('/vote', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

// Portal / Admin Launcher
app.get('/portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// REST endpoint to inspect poll status
app.get('/api/state', (req, res) => {
  res.json(getSafeState());
});

// Server-side State
const pollState = {
  isOpen: false,
  question: "Which Indian state has the longest mainland coastline?",
  options: {
    A: "Gujarat",
    B: "Maharashtra",
    C: "Tamil Nadu",
    D: "Andhra Pradesh"
  },
  votes: { A: 0, B: 0, C: 0, D: 0 },
  totalVotes: 0,
  percentages: { A: 0, B: 0, C: 0, D: 0 },
  pollId: 1
};

// Track sockets that have voted in current poll round
const votedSockets = new Set();

/**
 * Calculates whole number percentages for A, B, C, D
 */
function calculatePercentages() {
  const total = pollState.votes.A + pollState.votes.B + pollState.votes.C + pollState.votes.D;
  pollState.totalVotes = total;

  if (total === 0) {
    pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
    return;
  }

  pollState.percentages = {
    A: Math.round((pollState.votes.A / total) * 100),
    B: Math.round((pollState.votes.B / total) * 100),
    C: Math.round((pollState.votes.C / total) * 100),
    D: Math.round((pollState.votes.D / total) * 100)
  };
}

/**
 * Returns a clone of current state
 */
function getSafeState() {
  return {
    isOpen: pollState.isOpen,
    question: pollState.question,
    options: { ...pollState.options },
    votes: { ...pollState.votes },
    totalVotes: pollState.totalVotes,
    percentages: { ...pollState.percentages },
    pollId: pollState.pollId
  };
}

/**
 * Broadcasts poll update to all connected clients
 */
function broadcastState(action = 'update') {
  const state = getSafeState();
  io.emit('pollUpdated', {
    ...state,
    action
  });
}

// Socket.io Realtime Logic
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id} | Total Connections: ${io.engine.clientsCount}`);

  // Send initial state upon connection
  socket.emit('pollState', getSafeState());

  // Automatic Cookie handshake authentication
  const cookieHeader = socket.handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = parseCookie(cookieHeader);
    if (cookies.host_token && activeHostTokens.has(cookies.host_token)) {
      authenticatedHostSockets.add(socket.id);
      socket.emit('hostAuthSuccess', { authenticated: true });
    }
  }

  // Explicit host authentication event
  socket.on('hostAuthenticate', (data, ack) => {
    const token = data && data.token;
    if (token && activeHostTokens.has(token)) {
      authenticatedHostSockets.add(socket.id);
      if (typeof ack === 'function') ack({ success: true });
      socket.emit('hostAuthSuccess', { authenticated: true });
    } else {
      if (typeof ack === 'function') ack({ success: false, message: 'Unauthorized session' });
      socket.emit('hostAuthFailed', { message: 'Unauthorized session' });
    }
  });

  // Protected: setQuestion
  socket.on('setQuestion', (data) => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Authentication required. Please login.' });
      return;
    }

    console.log('[Poll Event] setQuestion received:', data);
    if (data && data.question) {
      pollState.question = String(data.question).trim();
    }
    if (data && data.options) {
      pollState.options = {
        A: data.options.A ? String(data.options.A).trim() : 'Option A',
        B: data.options.B ? String(data.options.B).trim() : 'Option B',
        C: data.options.C ? String(data.options.C).trim() : 'Option C',
        D: data.options.D ? String(data.options.D).trim() : 'Option D'
      };
    }

    if (data && data.startNewPoll) {
      pollState.votes = { A: 0, B: 0, C: 0, D: 0 };
      pollState.totalVotes = 0;
      pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
      pollState.isOpen = true;
      pollState.pollId += 1;
      votedSockets.clear();
      broadcastState('started');
    } else {
      broadcastState('questionUpdated');
    }
  });

  // Protected: startPoll
  socket.on('startPoll', (data) => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Authentication required. Please login.' });
      return;
    }

    console.log('[Poll Event] startPoll received');
    if (data && data.question) {
      pollState.question = String(data.question).trim();
    }
    if (data && data.options) {
      pollState.options = {
        A: data.options.A ? String(data.options.A).trim() : pollState.options.A,
        B: data.options.B ? String(data.options.B).trim() : pollState.options.B,
        C: data.options.C ? String(data.options.C).trim() : pollState.options.C,
        D: data.options.D ? String(data.options.D).trim() : pollState.options.D
      };
    }
    pollState.votes = { A: 0, B: 0, C: 0, D: 0 };
    pollState.totalVotes = 0;
    pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
    pollState.isOpen = true;
    pollState.pollId += 1;
    votedSockets.clear();

    broadcastState('started');
  });

  // Protected: stopPoll
  socket.on('stopPoll', () => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Authentication required. Please login.' });
      return;
    }

    console.log('[Poll Event] stopPoll received');
    pollState.isOpen = false;
    broadcastState('stopped');
  });

  // Protected: resetPoll
  socket.on('resetPoll', () => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Authentication required. Please login.' });
      return;
    }

    console.log('[Poll Event] resetPoll received');
    pollState.votes = { A: 0, B: 0, C: 0, D: 0 };
    pollState.totalVotes = 0;
    pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
    pollState.isOpen = false;
    pollState.pollId += 1;
    votedSockets.clear();

    broadcastState('reset');
  });

  // Audience Event: castVote (Public)
  socket.on('castVote', (payload) => {
    const option = typeof payload === 'string' ? payload.toUpperCase() : (payload && payload.option ? String(payload.option).toUpperCase() : '');

    // 1. Validation: Poll must be open
    if (!pollState.isOpen) {
      socket.emit('voteError', { message: 'Voting is currently closed.' });
      return;
    }

    // 2. Validation: Option must be A, B, C, or D
    if (!['A', 'B', 'C', 'D'].includes(option)) {
      socket.emit('voteError', { message: 'Invalid option selected. Choose A, B, C, or D.' });
      return;
    }

    // 3. Validation: Single vote per client socket in this round
    if (votedSockets.has(socket.id)) {
      socket.emit('voteError', { message: 'You have already voted in this round.' });
      return;
    }

    // Record vote
    votedSockets.add(socket.id);
    pollState.votes[option] += 1;
    calculatePercentages();

    console.log(`[Vote Cast] Option: ${option} by ${socket.id} | Totals: A=${pollState.votes.A}, B=${pollState.votes.B}, C=${pollState.votes.C}, D=${pollState.votes.D} (Total: ${pollState.totalVotes})`);

    // Confirm vote to the voter
    socket.emit('voteConfirmed', {
      option,
      pollId: pollState.pollId
    });

    // Broadcast updated counts and percentages to all screens
    broadcastState('vote');
  });

  socket.on('disconnect', () => {
    authenticatedHostSockets.delete(socket.id);
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`
===========================================================
  KBC "ASK THE AUDIENCE" POLL SERVER STARTED
===========================================================
  Host Login Screen:     http://localhost:${PORT}/login
  Host Protected Stage:  http://localhost:${PORT}/host
  Audience Voting Screen:http://localhost:${PORT}/ (or /audience)
  Credentials (Default): admin / admin123
===========================================================
`);
});
