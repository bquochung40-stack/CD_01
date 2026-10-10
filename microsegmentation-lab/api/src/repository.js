'use strict';

const { Pool } = require('pg');
const recipeColumns = 'id, name, description, category, cook_minutes, ingredients, instructions, created_at, (image_data IS NOT NULL) AS has_image';

function createRepository() {
  const pool = new Pool({
    max: 5,
    connectionTimeoutMillis: 5000
  });

  return {
    async migrate() {
      await pool.query(`ALTER TABLE recipes
        ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'Khác',
        ADD COLUMN IF NOT EXISTS cook_minutes INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ingredients TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS image_mime VARCHAR(20),
        ADD COLUMN IF NOT EXISTS image_data BYTEA`);
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    async list() {
      const result = await pool.query(
        `SELECT ${recipeColumns} FROM recipes ORDER BY id`
      );
      return result.rows;
    },
    async get(id) {
      const result = await pool.query(
        `SELECT ${recipeColumns} FROM recipes WHERE id = $1`,
        [id]
      );
      return result.rows[0] || null;
    },
    async getImage(id) {
      const result = await pool.query('SELECT image_mime, image_data FROM recipes WHERE id = $1', [id]);
      return result.rows[0] || null;
    },
    async create(recipe) {
      const image = recipe.image.kind === 'replace' ? recipe.image : null;
      const result = await pool.query(
        `INSERT INTO recipes (name, description, category, cook_minutes, ingredients, instructions, image_mime, image_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${recipeColumns}`,
        [recipe.name, recipe.description, recipe.category, recipe.cook_minutes, recipe.ingredients, recipe.instructions,
          image?.mime || null, image?.data || null]
      );
      return result.rows[0];
    },
    async update(id, recipe) {
      const image = recipe.image.kind === 'replace' ? recipe.image : null;
      const result = await pool.query(
        `UPDATE recipes SET name = $2, description = $3, category = $4,
         cook_minutes = $5, ingredients = $6, instructions = $7,
         image_mime = CASE WHEN $8 = 'keep' THEN image_mime ELSE $9 END,
         image_data = CASE WHEN $8 = 'keep' THEN image_data ELSE $10 END
         WHERE id = $1 RETURNING ${recipeColumns}`,
        [id, recipe.name, recipe.description, recipe.category, recipe.cook_minutes, recipe.ingredients, recipe.instructions,
          recipe.image.kind, image?.mime || null, image?.data || null]
      );
      return result.rows[0] || null;
    },
    async remove(id) {
      const result = await pool.query('DELETE FROM recipes WHERE id = $1 RETURNING id', [id]);
      return result.rowCount > 0;
    },
    async close() {
      await pool.end();
    }
  };
}

module.exports = { createRepository };
