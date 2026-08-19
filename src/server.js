const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Intentionally keeps HTTP handling, business rules, and persistence together.
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const PORT = 3000;
const STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

function readCollection(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCollection(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

function error(response, status, message) {
  send(response, status, { status, message });
}

function parseId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function validateUser(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) return 'User name is required';
  if (typeof input.email !== 'string' || !input.email.trim()) return 'User email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return 'User email must have a valid email format';
  return null;
}

function validateTask(input, partial = false) {
  if (!partial && (!input || typeof input.title !== 'string' || !input.title.trim())) return 'Task title is required';
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) return 'Task title is required';
  if (typeof input.title === 'string' && input.title.length > 100) return 'Task title must not exceed 100 characters';
  if (input.description !== undefined && input.description !== null && (typeof input.description !== 'string' || input.description.length > 1000)) return 'Task description must not exceed 1000 characters';
  if (input.status !== undefined && !STATUSES.includes(input.status)) return 'Task status must be one of TODO, IN_PROGRESS, COMPLETED';
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) return 'Task priority must be one of LOW, MEDIUM, HIGH';
  return null;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Request body must be valid JSON')); }
    });
    request.on('error', reject);
  });
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const users = readCollection(USERS_FILE);
  const tasks = readCollection(TASKS_FILE);

  try {
    if (request.method === 'POST' && url.pathname === '/api/users') {
      const input = await readBody(request);
      const validationError = validateUser(input);
      if (validationError) return error(response, 400, validationError);
      if (users.some(user => user.email.toLowerCase() === input.email.toLowerCase())) return error(response, 409, 'Email already exists');
      const user = { id: users.length ? Math.max(...users.map(item => item.id)) + 1 : 1, name: input.name.trim(), email: input.email.trim() };
      users.push(user); writeCollection(USERS_FILE, users);
      return send(response, 201, user);
    }

    if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'users' && parts.length === 3) {
      const user = users.find(item => item.id === parseId(parts[2]));
      return user ? send(response, 200, user) : error(response, 404, 'User not found');
    }

    if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'users' && parts[3] === 'tasks') {
      const userId = parseId(parts[2]);
      if (!users.some(user => user.id === userId)) return error(response, 404, 'User not found');
      return send(response, 200, tasks.filter(task => task.userId === userId));
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      const input = await readBody(request);
      const validationError = validateTask(input);
      if (validationError) return error(response, 400, validationError);
      if (!users.some(user => user.id === input.userId)) return error(response, 404, 'User not found');
      const now = new Date().toISOString();
      const task = { id: tasks.length ? Math.max(...tasks.map(item => item.id)) + 1 : 1, title: input.title.trim(), description: input.description ?? null, status: input.status || 'TODO', priority: input.priority || 'MEDIUM', userId: input.userId, createdAt: now, updatedAt: now };
      tasks.push(task); writeCollection(TASKS_FILE, tasks);
      return send(response, 201, task);
    }

    if (parts[0] === 'api' && parts[1] === 'tasks' && parts.length === 3) {
      const taskId = parseId(parts[2]);
      const index = tasks.findIndex(task => task.id === taskId);
      if (index < 0) return error(response, 404, 'Task not found');
      if (request.method === 'GET') return send(response, 200, tasks[index]);
      if (request.method === 'PUT') {
        const input = await readBody(request);
        const validationError = validateTask(input, true);
        if (validationError) return error(response, 400, validationError);
        if (input.userId !== undefined && !users.some(user => user.id === input.userId)) return error(response, 404, 'User not found');
        tasks[index] = { ...tasks[index], ...input, updatedAt: new Date().toISOString() };
        writeCollection(TASKS_FILE, tasks);
        return send(response, 200, tasks[index]);
      }
      if (request.method === 'DELETE') {
        tasks.splice(index, 1); writeCollection(TASKS_FILE, tasks);
        response.writeHead(204); return response.end();
      }
    }

    error(response, 404, 'Route not found');
  } catch (requestError) {
    error(response, requestError.message === 'Request body must be valid JSON' ? 400 : 500, requestError.message);
  }
}

function createServer() {
  return http.createServer(handle);
}

if (require.main === module) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) writeCollection(USERS_FILE, []);
  if (!fs.existsSync(TASKS_FILE)) writeCollection(TASKS_FILE, []);
  createServer().listen(PORT, () => console.log(`Task Management API listening on http://localhost:${PORT}`));
}

module.exports = { createServer, validateTask, validateUser };
