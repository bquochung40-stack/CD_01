'use strict';

const express = require('express');
const categories = ['Món chính', 'Món canh', 'Món nước', 'Món ăn nhẹ', 'Tráng miệng', 'Khác'];
const maxImageBytes = 2 * 1024 * 1024;

function parseImage(value) {
  if (value === undefined) return { kind: 'keep' };
  if (value === null) return { kind: 'remove' };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.mime !== 'string' || typeof value.data !== 'string' ||
      value.data.length > Math.ceil(maxImageBytes / 3) * 4 + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) return null;
  const data = Buffer.from(value.data, 'base64');
  if (!data.length || data.length > maxImageBytes || data.toString('base64') !== value.data) return null;
  const png = data.length >= 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    data.toString('ascii', 12, 16) === 'IHDR' && data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0;
  const jpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const webp = data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!((value.mime === 'image/png' && png) || (value.mime === 'image/jpeg' && jpeg) ||
    (value.mime === 'image/webp' && webp))) return null;
  return { kind: 'replace', mime: value.mime, data };
}

function parseId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseRecipe(body) {
  if (!body || typeof body.name !== 'string' || typeof body.description !== 'string') {
    return null;
  }
  const name = body.name.trim();
  const description = body.description.trim();
  const category = body.category === undefined ? 'Khác' : body.category;
  const cookMinutes = body.cook_minutes === undefined ? 0 : body.cook_minutes;
  const ingredients = body.ingredients === undefined ? '' : body.ingredients;
  const instructions = body.instructions === undefined ? '' : body.instructions;
  const image = parseImage(body.image);
  if (name.length < 2 || name.length > 100 || description.length > 500 ||
      !categories.includes(category) || !Number.isInteger(cookMinutes) || cookMinutes < 0 || cookMinutes > 600 ||
      typeof ingredients !== 'string' || ingredients.length > 3000 ||
      typeof instructions !== 'string' || instructions.length > 3000 || !image) {
    return null;
  }
  return { name, description, category, cook_minutes: cookMinutes,
    ingredients: ingredients.trim(), instructions: instructions.trim(), image };
}

function createApp(repository) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', async (request, response, next) => {
    try {
      await repository.ping();
      response.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/recipes', async (request, response, next) => {
    try {
      response.json({ recipes: await repository.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/recipes', async (request, response, next) => {
    const recipe = parseRecipe(request.body);
    if (!recipe) return response.status(400).json({ error: 'Kiểm tra thông tin món ăn. Ảnh phải là PNG, JPEG hoặc WebP hợp lệ, tối đa 2 MB.' });
    try {
      response.status(201).json({ recipe: await repository.create(recipe) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/recipes/:id', async (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return response.status(400).json({ error: 'ID không hợp lệ.' });
    try {
      const recipe = await repository.get(id);
      if (!recipe) return response.status(404).json({ error: 'Không tìm thấy công thức.' });
      response.json({ recipe });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/recipes/:id/image', async (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return response.status(400).json({ error: 'ID không hợp lệ.' });
    try {
      const image = await repository.getImage(id);
      if (!image || !image.image_data) return response.status(404).json({ error: 'Món ăn chưa có ảnh.' });
      response.set('X-Content-Type-Options', 'nosniff');
      response.set('Cache-Control', 'no-store');
      response.type(image.image_mime).send(image.image_data);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/recipes/:id', async (request, response, next) => {
    const id = parseId(request.params.id);
    const recipe = parseRecipe(request.body);
    if (!id || !recipe) return response.status(400).json({ error: 'ID hoặc dữ liệu không hợp lệ.' });
    try {
      const updated = await repository.update(id, recipe);
      if (!updated) return response.status(404).json({ error: 'Không tìm thấy công thức.' });
      response.json({ recipe: updated });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/recipes/:id', async (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id) return response.status(400).json({ error: 'ID không hợp lệ.' });
    try {
      if (!(await repository.remove(id))) return response.status(404).json({ error: 'Không tìm thấy công thức.' });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((error, request, response, next) => {
    if (error.status === 413) {
      return response.status(413).json({ error: 'Ảnh quá lớn. Chọn ảnh tối đa 2 MB.' });
    }
    if (error instanceof SyntaxError && error.status === 400) {
      return response.status(400).json({ error: 'JSON không hợp lệ.' });
    }
    console.error('Request failed:', error);
    response.status(503).json({ error: 'Dịch vụ tạm thời không khả dụng.' });
  });

  return app;
}

module.exports = { createApp };
