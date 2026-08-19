const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../src/server');

const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const tasksFile = path.join(__dirname, '..', 'data', 'tasks.json');
let server;
let baseUrl;

function resetData() {
  fs.writeFileSync(usersFile, '[]\n');
  fs.writeFileSync(tasksFile, '[]\n');
}

async function request(method, route, body) {
  const result = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await result.text();
  return { status: result.status, body: text ? JSON.parse(text) : null };
}

test.before(async () => {
  resetData();
  server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(() => server.close());

test('creates and retrieves a user', async () => {
  const created = await request('POST', '/api/users', { name: 'John', email: 'john@example.com' });
  assert.equal(created.status, 201);
  const found = await request('GET', `/api/users/${created.body.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.email, 'john@example.com');
});

test('rejects duplicate user emails', async () => {
  const duplicate = await request('POST', '/api/users', { name: 'Another', email: 'JOHN@example.com' });
  assert.equal(duplicate.status, 409);
});

test('creates, lists, retrieves, updates, and deletes a task', async () => {
  const created = await request('POST', '/api/tasks', { title: 'Write docs', description: 'API docs', status: 'TODO', priority: 'HIGH', userId: 1 });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'TODO');
  const list = await request('GET', '/api/users/1/tasks');
  assert.equal(list.body.length, 1);
  const updated = await request('PUT', `/api/tasks/${created.body.id}`, { status: 'COMPLETED' });
  assert.equal(updated.body.status, 'COMPLETED');
  const found = await request('GET', `/api/tasks/${created.body.id}`);
  assert.equal(found.status, 200);
  const deleted = await request('DELETE', `/api/tasks/${created.body.id}`);
  assert.equal(deleted.status, 204);
});

test('rejects invalid tasks and unknown users/tasks', async () => {
  const invalid = await request('POST', '/api/tasks', { title: 'x'.repeat(101), userId: 1 });
  assert.equal(invalid.status, 400);
  const unknownUser = await request('POST', '/api/tasks', { title: 'Task', userId: 999 });
  assert.equal(unknownUser.status, 404);
  const unknownTask = await request('GET', '/api/tasks/999');
  assert.equal(unknownTask.status, 404);
});
