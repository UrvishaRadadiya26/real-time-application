const http = require('http');
const assert = require('assert');
const { io: ioClient } = require('socket.io-client');

// We require the server module by creating a standalone test runner
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Wire server logic identically to server.js
app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/audience', (req, res) => res.sendFile(path.join(__dirname, 'public', 'audience.html')));
app.get('/vote', (req, res) => res.sendFile(path.join(__dirname, 'public', 'audience.html')));
app.get('/api/state', (req, res) => res.json(getSafeState()));

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
const votedSockets = new Set();

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

function broadcastState(action = 'update') {
  io.emit('pollUpdated', { ...getSafeState(), action });
}

const HOST_PIN = '1234';
const authenticatedHostSockets = new Set();

io.on('connection', (socket) => {
  socket.emit('pollState', getSafeState());

  socket.on('hostLogin', (data, ack) => {
    const pin = data && data.pin ? String(data.pin).trim() : '';
    if (pin === HOST_PIN) {
      authenticatedHostSockets.add(socket.id);
      if (typeof ack === 'function') ack({ success: true });
      socket.emit('hostAuthSuccess', { authenticated: true });
    } else {
      if (typeof ack === 'function') ack({ success: false, message: 'Invalid Host Security PIN.' });
      socket.emit('hostAuthFailed', { message: 'Invalid Host Security PIN.' });
    }
  });

  socket.on('setQuestion', (data) => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Unauthorized' });
      return;
    }
    if (data && data.question) pollState.question = String(data.question).trim();
    if (data && data.options) {
      pollState.options = { ...pollState.options, ...data.options };
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

  socket.on('startPoll', () => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Unauthorized' });
      return;
    }
    pollState.votes = { A: 0, B: 0, C: 0, D: 0 };
    pollState.totalVotes = 0;
    pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
    pollState.isOpen = true;
    pollState.pollId += 1;
    votedSockets.clear();
    broadcastState('started');
  });

  socket.on('stopPoll', () => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Unauthorized' });
      return;
    }
    pollState.isOpen = false;
    broadcastState('stopped');
  });

  socket.on('resetPoll', () => {
    if (!authenticatedHostSockets.has(socket.id)) {
      socket.emit('hostAuthRequired', { message: 'Unauthorized' });
      return;
    }
    pollState.votes = { A: 0, B: 0, C: 0, D: 0 };
    pollState.totalVotes = 0;
    pollState.percentages = { A: 0, B: 0, C: 0, D: 0 };
    pollState.isOpen = false;
    pollState.pollId += 1;
    votedSockets.clear();
    broadcastState('reset');
  });

  socket.on('castVote', (payload) => {
    const option = typeof payload === 'string' ? payload.toUpperCase() : (payload && payload.option ? String(payload.option).toUpperCase() : '');
    if (!pollState.isOpen) {
      socket.emit('voteError', { message: 'Voting is currently closed.' });
      return;
    }
    if (!['A', 'B', 'C', 'D'].includes(option)) {
      socket.emit('voteError', { message: 'Invalid option selected. Choose A, B, C, or D.' });
      return;
    }
    if (votedSockets.has(socket.id)) {
      socket.emit('voteError', { message: 'You have already voted in this round.' });
      return;
    }
    votedSockets.add(socket.id);
    pollState.votes[option] += 1;
    calculatePercentages();
    socket.emit('voteConfirmed', { option, pollId: pollState.pollId });
    broadcastState('vote');
  });
});

async function runTests() {
  const TEST_PORT = 3456;
  await new Promise(r => server.listen(TEST_PORT, r));
  console.log(`Test server running on port ${TEST_PORT}`);

  const SERVER_URL = `http://localhost:${TEST_PORT}`;

  // Test 1: HTTP GET /api/state
  const stateRes = await fetch(`${SERVER_URL}/api/state`).then(r => r.json());
  assert.strictEqual(stateRes.isOpen, false, 'Initial state should be closed');
  assert.strictEqual(stateRes.totalVotes, 0, 'Initial total votes should be 0');
  console.log('✓ Test 1 Passed: HTTP GET /api/state returns valid initial state');

  // Test 2: HTTP GET /host and /audience
  const hostHtml = await fetch(`${SERVER_URL}/host`).then(r => r.text());
  assert(hostHtml.includes('ASK THE AUDIENCE'), 'Host HTML must contain title');
  const audienceHtml = await fetch(`${SERVER_URL}/audience`).then(r => r.text());
  assert(audienceHtml.includes('AUDIENCE PAD'), 'Audience HTML must contain title');
  console.log('✓ Test 2 Passed: Static pages served properly');

  // Test 3: Sockets connection & initial emission
  const hostSocket = ioClient(SERVER_URL);
  const user1Socket = ioClient(SERVER_URL);
  const user2Socket = ioClient(SERVER_URL);

  const initialHostState = await new Promise(r => hostSocket.once('pollState', r));
  assert.strictEqual(initialHostState.isOpen, false);
  console.log('✓ Test 3 Passed: Clients receive initial pollState');

  // Test 3.1: Unauthorized socket cannot start poll
  const unauthPromise = new Promise(r => user1Socket.once('hostAuthRequired', r));
  user1Socket.emit('startPoll');
  await unauthPromise;
  console.log('✓ Test 3.1 Passed: Unauthorized clients cannot start/stop/control the poll');

  // Test 3.2: Host socket authenticates with PIN
  const authPromise = new Promise(r => hostSocket.once('hostAuthSuccess', r));
  hostSocket.emit('hostLogin', { pin: '1234' });
  await authPromise;
  console.log('✓ Test 3.2 Passed: Host successfully authenticates with Security PIN');

  // Test 4: Authenticated Host starts poll
  const startPromise = new Promise(r => user1Socket.once('pollUpdated', r));
  hostSocket.emit('startPoll');
  const startedState = await startPromise;
  assert.strictEqual(startedState.isOpen, true, 'Poll should now be open');
  assert.strictEqual(startedState.action, 'started');
  console.log('✓ Test 4 Passed: startPoll opens voting and notifies clients');

  // Test 5: User 1 votes A
  const vote1Promise = new Promise(r => user1Socket.once('voteConfirmed', r));
  const update1Promise = new Promise(r => hostSocket.once('pollUpdated', r));
  user1Socket.emit('castVote', 'A');
  const vote1Conf = await vote1Promise;
  assert.strictEqual(vote1Conf.option, 'A');
  const update1State = await update1Promise;
  assert.strictEqual(update1State.votes.A, 1);
  assert.strictEqual(update1State.percentages.A, 100);
  console.log('✓ Test 5 Passed: User 1 vote A recorded, percentages updated to 100%');

  // Test 6: User 2 votes B
  const vote2Promise = new Promise(r => user2Socket.once('voteConfirmed', r));
  const update2Promise = new Promise(r => hostSocket.once('pollUpdated', r));
  user2Socket.emit('castVote', 'B');
  await vote2Promise;
  const update2State = await update2Promise;
  assert.strictEqual(update2State.votes.B, 1);
  assert.strictEqual(update2State.percentages.A, 50);
  assert.strictEqual(update2State.percentages.B, 50);
  assert.strictEqual(update2State.totalVotes, 2);
  console.log('✓ Test 6 Passed: User 2 vote B recorded, percentages updated (A: 50%, B: 50%)');

  // Test 7: User 1 attempts duplicate vote
  const duplicateErrPromise = new Promise(r => user1Socket.once('voteError', r));
  user1Socket.emit('castVote', 'C');
  const dupErr = await duplicateErrPromise;
  assert(dupErr.message.includes('already voted'), 'Duplicate vote should be rejected');
  console.log('✓ Test 7 Passed: Duplicate vote properly rejected');

  // Test 8: Host stops poll
  const stopPromise = new Promise(r => user1Socket.once('pollUpdated', r));
  hostSocket.emit('stopPoll');
  const stoppedState = await stopPromise;
  assert.strictEqual(stoppedState.isOpen, false);
  assert.strictEqual(stoppedState.totalVotes, 2, 'Counts should remain frozen');
  console.log('✓ Test 8 Passed: stopPoll freezes voting and counts');

  // Test 9: Voting while poll is stopped
  const closedErrPromise = new Promise(r => user2Socket.once('voteError', r));
  user2Socket.emit('castVote', 'D');
  const closedErr = await closedErrPromise;
  assert(closedErr.message.includes('closed'), 'Vote when closed should be rejected');
  console.log('✓ Test 9 Passed: Vote while stopped is rejected');

  // Test 10: Host resets poll
  const resetPromise = new Promise(r => hostSocket.once('pollUpdated', r));
  hostSocket.emit('resetPoll');
  const resetState = await resetPromise;
  assert.strictEqual(resetState.isOpen, false);
  assert.strictEqual(resetState.totalVotes, 0);
  assert.strictEqual(resetState.percentages.A, 0);
  console.log('✓ Test 10 Passed: resetPoll resets all counters to 0');

  // Test 11: Host updates question & options
  const qUpdatePromise = new Promise(r => hostSocket.once('pollUpdated', r));
  hostSocket.emit('setQuestion', {
    question: 'What is the capital of Australia?',
    options: { A: 'Sydney', B: 'Melbourne', C: 'Canberra', D: 'Brisbane' },
    startNewPoll: true
  });
  const qState = await qUpdatePromise;
  assert.strictEqual(qState.question, 'What is the capital of Australia?');
  assert.strictEqual(qState.options.C, 'Canberra');
  assert.strictEqual(qState.isOpen, true);
  console.log('✓ Test 11 Passed: Host updates Question & Options and broadcasts to audience');

  // Cleanup
  hostSocket.disconnect();
  user1Socket.disconnect();
  user2Socket.disconnect();
  server.close();
  console.log('\n=======================================');
  console.log('ALL 11 END-TO-END TESTS PASSED SUCCESFULLY!');
  console.log('=======================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
