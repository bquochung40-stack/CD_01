CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  category VARCHAR(30) NOT NULL DEFAULT 'Khác',
  cook_minutes INTEGER NOT NULL DEFAULT 0,
  ingredients TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  image_mime VARCHAR(20),
  image_data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO recipes (name, description, category, cook_minutes, ingredients, instructions) VALUES
  ('Cơm chiên trứng', 'Món cơm gia đình nhanh gọn với trứng và hành lá.', 'Món chính', 20, 'Cơm nguội, trứng, hành lá, dầu ăn, gia vị.', 'Đánh trứng. Đảo cơm với dầu nóng, thêm trứng và nêm vừa ăn. Rắc hành lá.'),
  ('Canh rau ngót', 'Canh rau ngót thanh mát cho bữa cơm hằng ngày.', 'Món canh', 25, 'Rau ngót, thịt băm, nước, gia vị.', 'Phi thơm thịt băm, thêm nước. Khi sôi cho rau ngót vào, nêm vừa ăn.'),
  ('Gà kho gừng', 'Thịt gà kho đậm vị với gừng tươi.', 'Món chính', 45, 'Thịt gà, gừng, hành tím, nước mắm, đường.', 'Ướp gà với gia vị. Phi gừng và hành, cho gà vào đảo săn rồi kho nhỏ lửa.');
