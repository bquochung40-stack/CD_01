'use strict';

const form = document.getElementById('recipe-form');
const nameInput = document.getElementById('name');
const descriptionInput = document.getElementById('description');
const descriptionCount = document.getElementById('description-count');
const categoryInput = document.getElementById('category');
const cookMinutesInput = document.getElementById('cook-minutes');
const ingredientsInput = document.getElementById('ingredients');
const instructionsInput = document.getElementById('instructions');
const imageInput = document.getElementById('image');
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const removeImageButton = document.getElementById('remove-image');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const sortInput = document.getElementById('sort');
const refreshButton = document.getElementById('refresh-button');
const list = document.getElementById('recipes');
const count = document.getElementById('count');
const message = document.getElementById('message');
const cancel = document.getElementById('cancel-button');
const save = document.getElementById('save-button');
const connection = document.getElementById('connection');
const connectionText = document.getElementById('connection-text');
let editingId = null;
let recipes = [];
let busy = false;
let editingHasImage = false;
let imageRemoved = false;
let previewObjectUrl = null;
const maxImageBytes = 2 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

async function callApi(path, options) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  if (response.status === 504) {
    throw new Error('Máy chủ xử lý quá thời gian chờ. Công thức có thể đã được lưu; hãy tải lại danh sách trước khi lưu lại để tránh trùng món.');
  }
  if (response.status === 502 || response.status === 503) {
    throw new Error('API tạm thời chưa sẵn sàng. Vui lòng thử tải lại danh sách sau ít giây.');
  }
  if (response.status === 413) {
    throw new Error('Dữ liệu gửi quá lớn. Chọn ảnh tối đa 2 MB.');
  }
  const body = await response.json().catch(() => {
    throw new Error('Máy chủ trả phản hồi không hợp lệ (HTTP ' + response.status + '). Hãy tải lại danh sách trước khi thử lưu lại.');
  });
  if (!response.ok) throw new Error(body.error || 'Yêu cầu thất bại.');
  return body;
}

function setConnection(online) {
  connection.classList.toggle('online', online);
  connection.classList.toggle('offline', !online);
  connectionText.textContent = online ? 'API và dữ liệu sẵn sàng' : 'Không kết nối được API';
}

function showMessage(text, success = false) {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle('success', success);
}

function updateDescriptionCount() {
  descriptionCount.textContent = descriptionInput.value.length;
}

function updateImagePreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  const file = imageInput.files[0];
  if (file) {
    if (!imageTypes.includes(file.type) || file.size > maxImageBytes || file.size === 0) {
      imageInput.value = '';
      showMessage('Chọn ảnh JPEG, PNG hoặc WebP không quá 2 MB.');
      updateImagePreview();
      return;
    }
    previewObjectUrl = URL.createObjectURL(file);
    previewImage.src = previewObjectUrl;
    imagePreview.hidden = false;
  } else if (editingId !== null && editingHasImage && !imageRemoved) {
    previewImage.src = '/api/recipes/' + editingId + '/image';
    imagePreview.hidden = false;
  } else {
    previewImage.removeAttribute('src');
    imagePreview.hidden = true;
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = typeof reader.result === 'string' ? reader.result.split(',')[1] : null;
      if (encoded) resolve(encoded);
      else reject(new Error('Không đọc được ảnh đã chọn.'));
    };
    reader.onerror = () => reject(new Error('Không đọc được ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });
}

function resetForm() {
  form.reset();
  editingId = null;
  editingHasImage = false;
  imageRemoved = false;
  cancel.hidden = true;
  document.getElementById('form-title').textContent = 'Thêm công thức';
  save.textContent = 'Lưu công thức →';
  updateDescriptionCount();
  updateImagePreview();
}

function renderRecipes() {
  const query = searchInput.value.trim().toLocaleLowerCase('vi');
  const selectedCategory = categoryFilter.value;
  const visible = recipes.filter((recipe) =>
    (!selectedCategory || recipe.category === selectedCategory) &&
    (recipe.name + ' ' + recipe.description + ' ' + recipe.ingredients).toLocaleLowerCase('vi').includes(query));
  if (sortInput.value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  else if (sortInput.value === 'time') visible.sort((a, b) => (a.cook_minutes || 9999) - (b.cook_minutes || 9999) || a.id - b.id);
  else visible.sort((a, b) => b.id - a.id);
  count.textContent = query || selectedCategory ? visible.length + '/' + recipes.length + ' công thức' : recipes.length + ' công thức';
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query || selectedCategory ? 'Không tìm thấy món ăn phù hợp. Hãy thử từ khóa hoặc loại món khác.' : 'Chưa có công thức. Hãy thêm món đầu tiên!';
    list.append(empty);
    return;
  }
  for (const recipe of visible) {
    const item = document.createElement('article');
    item.className = 'recipe';
    if (recipe.has_image) {
      const cover = document.createElement('img');
      cover.className = 'recipe-cover';
      cover.src = '/api/recipes/' + recipe.id + '/image';
      cover.alt = 'Ảnh món ' + recipe.name;
      cover.loading = 'lazy';
      item.append(cover);
    }
    const title = document.createElement('h3');
    title.textContent = recipe.name;
    const description = document.createElement('p');
    description.className = 'recipe-description';
    description.textContent = recipe.description || 'Chưa có mô tả.';
    const meta = document.createElement('div');
    meta.className = 'recipe-meta';
    for (const label of [recipe.category, recipe.cook_minutes ? recipe.cook_minutes + ' phút' : 'Chưa rõ thời gian']) {
      const badge = document.createElement('span');
      badge.textContent = label;
      meta.append(badge);
    }
    const details = document.createElement('details');
    details.className = 'recipe-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Xem nguyên liệu và cách làm';
    details.append(summary);
    if (recipe.description.length > 160) {
      const fullTitle = document.createElement('h4');
      fullTitle.textContent = 'Mô tả đầy đủ';
      const fullDescription = document.createElement('p');
      fullDescription.textContent = recipe.description;
      details.append(fullTitle, fullDescription);
    }
    for (const [heading, value] of [['Nguyên liệu', recipe.ingredients], ['Cách làm', recipe.instructions]]) {
      const subtitle = document.createElement('h4');
      subtitle.textContent = heading;
      const content = document.createElement('p');
      content.textContent = value || 'Chưa cập nhật.';
      details.append(subtitle, content);
    }
    const actions = document.createElement('div');
    actions.className = 'recipe-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Sửa';
    edit.addEventListener('click', () => {
      editingId = recipe.id;
      nameInput.value = recipe.name;
      descriptionInput.value = recipe.description;
      categoryInput.value = recipe.category;
      cookMinutesInput.value = recipe.cook_minutes;
      ingredientsInput.value = recipe.ingredients;
      instructionsInput.value = recipe.instructions;
      editingHasImage = recipe.has_image;
      imageRemoved = false;
      imageInput.value = '';
      updateImagePreview();
      updateDescriptionCount();
      cancel.hidden = false;
      document.getElementById('form-title').textContent = 'Sửa công thức';
      save.textContent = 'Cập nhật công thức';
      showMessage('');
      document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      nameInput.focus({ preventScroll: true });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = 'Xóa';
    remove.addEventListener('click', async () => {
      if (busy || !confirm('Xóa công thức "' + recipe.name + '"?')) return;
      busy = true;
      remove.disabled = true;
      try {
        await callApi('/api/recipes/' + recipe.id, { method: 'DELETE' });
        if (editingId === recipe.id) resetForm();
        if (await loadRecipes()) showMessage('Đã xóa "' + recipe.name + '".', true);
      } catch (error) {
        showMessage(error.message);
        remove.disabled = false;
      } finally {
        busy = false;
      }
    });
    actions.append(edit, remove);
    item.append(title, meta, description, details, actions);
    list.append(item);
  }
}

async function loadRecipes() {
  try {
    const body = await callApi('/api/recipes');
    recipes = body.recipes;
    setConnection(true);
    renderRecipes();
    return true;
  } catch (error) {
    setConnection(false);
    count.textContent = '';
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Không tải được công thức. Kiểm tra container API và cơ sở dữ liệu, rồi tải lại trang.';
    list.append(empty);
    showMessage(error.message);
    return false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const wasEditing = editingId !== null;
  const path = wasEditing ? '/api/recipes/' + editingId : '/api/recipes';
  busy = true;
  save.disabled = true;
  showMessage('');
  try {
    const file = imageInput.files[0];
    const payload = {
      name: nameInput.value.trim(), description: descriptionInput.value.trim(),
      category: categoryInput.value, cook_minutes: Number(cookMinutesInput.value),
      ingredients: ingredientsInput.value.trim(), instructions: instructionsInput.value.trim()
    };
    if (file) {
      if (!imageTypes.includes(file.type) || file.size > maxImageBytes || file.size === 0) {
        throw new Error('Chọn ảnh JPEG, PNG hoặc WebP không quá 2 MB.');
      }
      payload.image = { mime: file.type, data: await readImage(file) };
    } else if (imageRemoved) {
      payload.image = null;
    }
    await callApi(path, {
      method: wasEditing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    resetForm();
    if (await loadRecipes()) {
      showMessage(wasEditing ? 'Đã cập nhật công thức.' : 'Đã thêm công thức mới.', true);
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
    save.disabled = false;
  }
});

cancel.addEventListener('click', () => { resetForm(); showMessage(''); });
descriptionInput.addEventListener('input', updateDescriptionCount);
imageInput.addEventListener('change', () => { imageRemoved = false; updateImagePreview(); });
removeImageButton.addEventListener('click', () => { imageInput.value = ''; imageRemoved = true; updateImagePreview(); });
searchInput.addEventListener('input', renderRecipes);
categoryFilter.addEventListener('change', renderRecipes);
sortInput.addEventListener('change', renderRecipes);
refreshButton.addEventListener('click', loadRecipes);
loadRecipes();
