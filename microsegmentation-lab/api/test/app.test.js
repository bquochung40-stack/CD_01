'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function fakeRepository() {
  const rows = [{ id: 1, name: 'Cơm chiên trứng', description: 'Món ăn gia đình', category: 'Khác', cook_minutes: 0, ingredients: '', instructions: '', has_image: false }];
  const images = new Map();
  let nextId = 2;
  return {
    async ping() {},
    async list() { return [...rows]; },
    async get(id) { return rows.find(row => row.id === id) || null; },
    async getImage(id) { return images.get(id) || null; },
    async create(recipe) {
      const { image, ...fields } = recipe;
      const row = { id: nextId++, ...fields, has_image: image.kind === 'replace' };
      if (row.has_image) images.set(row.id, { image_mime: image.mime, image_data: image.data });
      rows.push(row);
      return row;
    },
    async update(id, recipe) {
      const row = rows.find(item => item.id === id);
      if (!row) return null;
      const { image, ...fields } = recipe;
      Object.assign(row, fields);
      if (image.kind === 'replace') images.set(id, { image_mime: image.mime, image_data: image.data });
      if (image.kind === 'remove') images.delete(id);
      row.has_image = images.has(id);
      return row;
    },
    async remove(id) {
      const index = rows.findIndex(item => item.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      images.delete(id);
      return true;
    }
  };
}

test('CRUD works through the HTTP API with one recipe table', async () => {
  const server = createApp(fakeRepository()).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    let response = await fetch(base + '/api/recipes');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).recipes.length, 1);

    response = await fetch(base + '/api/recipes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Canh rau ngót', description: 'Thanh mát', category: 'Món canh', cook_minutes: 25, ingredients: 'Rau ngót', instructions: 'Nấu canh' })
    });
    assert.equal(response.status, 201);
    const created = (await response.json()).recipe;
    const id = created.id;
    assert.equal(created.category, 'Món canh');
    assert.equal(created.cook_minutes, 25);

    response = await fetch(base + '/api/recipes/' + id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Canh rau ngót thịt bằm', description: 'Bữa cơm tối', category: 'Món canh', cook_minutes: 30, ingredients: 'Rau ngót, thịt', instructions: 'Đun sôi' })
    });
    assert.equal(response.status, 200);
    const updated = (await response.json()).recipe;
    assert.equal(updated.name, 'Canh rau ngót thịt bằm');
    assert.equal(updated.ingredients, 'Rau ngót, thịt');

    response = await fetch(base + '/api/recipes/' + id, { method: 'DELETE' });
    assert.equal(response.status, 204);
    response = await fetch(base + '/api/recipes/' + id);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('image upload is validated, served, retained on edit and removable', async () => {
  const server = createApp(fakeRepository()).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/recipes';
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl1QgAAAABJRU5ErkJggg==';
    const fields = { name: 'Món có ảnh', description: '', image: { mime: 'image/png', data: png } };
    let response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) });
    assert.equal(response.status, 201);
    const created = (await response.json()).recipe;
    assert.equal(created.has_image, true);
    assert.equal(created.image, undefined);
    response = await fetch(base + '/' + created.id + '/image');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'), png);

    response = await fetch(base + '/' + created.id, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Món đổi tên', description: '' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).recipe.has_image, true);
    response = await fetch(base + '/' + created.id, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Món đổi tên', description: '', image: null }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).recipe.has_image, false);
    assert.equal((await fetch(base + '/' + created.id + '/image')).status, 404);

    response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ảnh giả', description: '', image: { mime: 'image/png', data: Buffer.from('<svg/>').toString('base64') } }) });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('invalid input is rejected before reaching the database', async () => {
  const server = createApp(fakeRepository()).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    let response = await fetch(base + '/api/recipes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', description: '' })
    });
    assert.equal(response.status, 400);
    response = await fetch(base + '/api/recipes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Món hợp lệ', description: '', category: 'Không tồn tại', cook_minutes: -1 })
    });
    assert.equal(response.status, 400);
    response = await fetch(base + '/api/recipes/not-an-id');
    assert.equal(response.status, 400);
    response = await fetch(base + '/api/recipes/999');
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
