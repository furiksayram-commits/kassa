const addProductForm = document.getElementById("addProductForm");
const addProductCategorySelect = document.getElementById("addProductCategorySelect");
const addProductUnitSelect = document.getElementById("addProductUnitSelect");
const importFileInput = document.getElementById("importFileInput");
const importBtn = document.getElementById("importBtn");
const importResult = document.getElementById("importResult");
const newCategoryInput = document.getElementById("newCategoryInput");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const categoriesManagerList = document.getElementById("categoriesManagerList");
const inventoryCategoryList = document.getElementById("inventoryCategoryList");
const inventorySearchInput = document.getElementById("inventorySearchInput");
const refreshInventoryBtn = document.getElementById("refreshInventoryBtn");
const inventoryTable = document.getElementById("inventoryTable");
const toast = document.getElementById("toast");

const editProductModal = document.getElementById("editProductModal");
const editProductForm = document.getElementById("editProductForm");
const editNameInput = document.getElementById("editNameInput");
const editCategorySelect = document.getElementById("editCategorySelect");
const editUnitSelect = document.getElementById("editUnitSelect");
const editPriceInput = document.getElementById("editPriceInput");
const editMinPriceInput = document.getElementById("editMinPriceInput");
const editCancelBtn = document.getElementById("editCancelBtn");

const state = {
  products: [],
  categories: [],
  editingProductId: null,
  selectedCategory: "all"
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function requestTextInput(message, defaultValue = "", options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(10, 20, 35, 0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.width = "min(420px, 92vw)";
    card.style.background = "#fff";
    card.style.border = "1px solid #d7e2ee";
    card.style.borderRadius = "12px";
    card.style.padding = "16px";
    card.style.boxShadow = "0 14px 32px rgba(16, 28, 42, 0.25)";

    const title = document.createElement("h3");
    title.textContent = options.title || "Введите значение";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "20px";

    const text = document.createElement("div");
    text.textContent = message || "";
    text.style.color = "#4d6075";
    text.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = options.password ? "password" : "text";
    input.inputMode = options.inputMode || "text";
    input.placeholder = options.placeholder || "";
    input.value = defaultValue == null ? "" : String(defaultValue);
    input.style.width = "100%";
    input.style.minHeight = "44px";
    input.style.fontSize = "20px";
    input.style.padding = "8px 10px";
    input.style.border = "1px solid #d7e2ee";
    input.style.borderRadius = "10px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Отмена";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn primary";
    okBtn.textContent = "OK";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener("click", () => finish(null));
    okBtn.addEventListener("click", () => finish(String(input.value || "").trim()));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter") finish(String(input.value || "").trim());
    });

    actions.append(cancelBtn, okBtn);
    card.append(title, text, input, actions);
    overlay.append(card);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

function formatMoney(value) {
  const amount = Math.round(Number(value || 0));
  return `${amount.toLocaleString("ru-RU")} т`;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[xх×*]/g, "*")
    .replace(/\s+/g, "");
}

function getCategoryName(item) {
  return item?.category || "Без категории";
}

async function loadProducts() {
  const res = await fetch("/api/products");
  if (!res.ok) throw new Error("Не удалось загрузить товары");
  state.products = await res.json();
  renderCategoryFilter();
  renderProducts();
}

async function loadCategories() {
  const res = await fetch("/api/categories");
  if (!res.ok) throw new Error("Не удалось загрузить категории");
  state.categories = await res.json();
  renderCategoryOptions();
  renderCategoryFilter();
  renderCategoriesManager();
}

function renderCategoryOptions() {
  const options = state.categories.length ? state.categories : [{ name: "Без категории" }];
  const html = options.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  addProductCategorySelect.innerHTML = html;
  editCategorySelect.innerHTML = html;
}

function renderCategoryFilter() {
  if (!inventoryCategoryList) return;

  const grouped = state.products.reduce((acc, product) => {
    const category = getCategoryName(product);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "ru"));
  const categories = ["all", ...sortedCategories];

  if (!categories.includes(state.selectedCategory)) {
    state.selectedCategory = "all";
  }

  inventoryCategoryList.innerHTML = categories
    .map((category) => {
      const label = category === "all" ? "Все товары" : category;
      const active = state.selectedCategory === category ? "is-active" : "";
      const count = category === "all" ? state.products.length : grouped[category];
      return `<button class="btn category-btn ${active}" data-inventory-category="${category}">${label} <span class="category-count">${count}</span></button>`;
    })
    .join("");

  document.querySelectorAll("[data-inventory-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedCategory = btn.dataset.inventoryCategory;
      inventorySearchInput.value = "";
      renderCategoryFilter();
      renderProducts();
    });
  });
}

function renderCategoriesManager() {
  if (!state.categories.length) {
    categoriesManagerList.innerHTML = "<p class=\"muted\">Категории не найдены</p>";
    return;
  }

  categoriesManagerList.innerHTML = state.categories
    .map(
      (c) => `
        <div class="category-manager-row">
          <strong>${c.name}</strong>
          <span class="muted">Товаров: ${c.productsCount}</span>
          <div class="inv-actions">
            <button class="btn small" data-cat-rename="${c.id}">Переименовать</button>
            <button class="btn small" data-cat-delete="${c.id}">Удалить</button>
          </div>
        </div>
      `
    )
    .join("");

  document.querySelectorAll("[data-cat-rename]").forEach((btn) => {
    btn.addEventListener("click", () => renameCategory(Number(btn.dataset.catRename)));
  });
  document.querySelectorAll("[data-cat-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteCategory(Number(btn.dataset.catDelete)));
  });
}

function renderProducts() {
  const q = normalizeSearchText(inventorySearchInput.value);
  const list = state.products.filter((item) => {
    const inCategory =
      state.selectedCategory === "all" || getCategoryName(item) === state.selectedCategory;
    const name = normalizeSearchText(item.name);
    const category = normalizeSearchText(getCategoryName(item));
    const inSearch = name.includes(q) || category.includes(q);
    return inCategory && inSearch;
  });

  if (list.length === 0) {
    inventoryTable.innerHTML = "<p class=\"muted\">Товары не найдены</p>";
    return;
  }

  inventoryTable.innerHTML = `
    <div class="inventory-products-list">
      <div class="inventory-products-head">
        <span>Товар</span>
        <span>Категория</span>
        <span>Ед.</span>
        <span>Цена</span>
        <span>Действия</span>
      </div>
      ${list
        .map(
          (p) => `
            <div class="inventory-product-row" data-edit-row="${p.id}">
              <div class="inv-name">${p.name}</div>
              <div class="inv-category">${getCategoryName(p)}</div>
              <div class="inv-unit">${p.unit || "шт"}</div>
              <div class="inv-price">${formatMoney(p.price)}</div>
              <div class="inv-actions">
                <button class="btn small" data-edit="${p.id}">Редактировать</button>
                <button class="btn small" data-reprice="${p.id}">Переоценка</button>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.edit));
  });
  document.querySelectorAll("[data-reprice]").forEach((btn) => {
    btn.addEventListener("click", () => repriceProduct(btn.dataset.reprice));
  });
  document.querySelectorAll("[data-edit-row]").forEach((row) => {
    row.addEventListener("dblclick", () => openEditModal(row.dataset.editRow));
  });
}

function openEditModal(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;

  state.editingProductId = productId;
  editNameInput.value = product.name || "";
  editCategorySelect.value = getCategoryName(product);
  editUnitSelect.value = product.unit || "шт";
  editPriceInput.value = Number(product.price || 0).toFixed(2);
  editMinPriceInput.value = Number(product.minPrice || product.price || 0).toFixed(2);
  editProductModal.classList.remove("hidden");
  editNameInput.focus();
}

function closeEditModal() {
  state.editingProductId = null;
  editProductModal.classList.add("hidden");
}

async function saveEditProduct(event) {
  event.preventDefault();
  if (!state.editingProductId) return;

  const payload = {
    name: String(editNameInput.value || "").trim(),
    category: String(editCategorySelect.value || "").trim(),
    unit: String(editUnitSelect.value || "шт").trim(),
    price: Number(editPriceInput.value),
    minPrice: Number(editMinPriceInput.value || editPriceInput.value)
  };

  try {
    const res = await fetch(`/api/products/${state.editingProductId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка обновления товара");

    closeEditModal();
    showToast("Товар обновлен");
    await Promise.all([loadProducts(), loadCategories()]);
  } catch (err) {
    showToast(err.message);
  }
}

async function addProduct(event) {
  event.preventDefault();
  const formData = new FormData(addProductForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    category: String(formData.get("category") || "").trim(),
    unit: String(formData.get("unit") || "шт").trim(),
    price: Number(formData.get("price")),
    minPrice: Number(formData.get("minPrice") || formData.get("price"))
  };

  try {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка добавления товара");

    addProductForm.reset();
    if (addProductUnitSelect) addProductUnitSelect.value = "шт";
    showToast("Товар добавлен");
    await Promise.all([loadProducts(), loadCategories()]);
  } catch (err) {
    showToast(err.message);
  }
}

async function addCategory() {
  const name = newCategoryInput.value.trim();
  if (!name) {
    showToast("Введите название категории");
    return;
  }

  try {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка создания категории");

    newCategoryInput.value = "";
    showToast("Категория добавлена");
    await loadCategories();
  } catch (err) {
    showToast(err.message);
  }
}

async function renameCategory(categoryId) {
  const current = state.categories.find((c) => c.id === categoryId);
  if (!current) return;
  const name = await requestTextInput("Новое название категории:", current.name, {
    title: "Переименовать категорию"
  });
  if (name === null) return;

  try {
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка переименования категории");

    showToast("Категория переименована");
    await Promise.all([loadCategories(), loadProducts()]);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteCategory(categoryId) {
  const current = state.categories.find((c) => c.id === categoryId);
  if (!current) return;

  let targetCategoryId = null;
  if (current.productsCount > 0) {
    const available = state.categories.filter((c) => c.id !== categoryId);
    if (!available.length) {
      showToast("Нельзя удалить последнюю категорию с товарами");
      return;
    }
    const listText = available.map((c) => `${c.id}: ${c.name}`).join("\n");
    const picked = await requestTextInput(
      `В категории есть товары. Укажите ID категории для переноса:\n${listText}`,
      String(available[0].id),
      { title: "Удаление категории", inputMode: "numeric", placeholder: "ID категории" }
    );
    if (picked === null) return;
    targetCategoryId = Number(picked);
  }

  try {
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetCategoryId ? { targetCategoryId } : {})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка удаления категории");

    showToast("Категория удалена");
    await Promise.all([loadCategories(), loadProducts()]);
  } catch (err) {
    showToast(err.message);
  }
}

async function importProducts() {
  const file = importFileInput.files?.[0];
  if (!file) {
    showToast("Выберите Excel файл");
    return;
  }

  importBtn.disabled = true;
  importResult.innerHTML = "";

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/products/import", {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Ошибка импорта");

    importResult.innerHTML = `
      <div>Добавлено: <strong>${result.created}</strong></div>
      <div>Обновлено: <strong>${result.updated}</strong></div>
      <div>Пропущено: <strong>${result.skipped || 0}</strong></div>
      ${
        result.errors.length
          ? `<div>Ошибки:<br>${result.errors.map((e) => `<div>${e}</div>`).join("")}</div>`
          : "<div>Ошибок нет</div>"
      }
    `;

    showToast("Импорт завершен");
    importFileInput.value = "";
    await Promise.all([loadProducts(), loadCategories()]);
  } catch (err) {
    showToast(err.message);
  } finally {
    importBtn.disabled = false;
  }
}

async function repriceProduct(productId) {
  const priceRaw = await requestTextInput("Новая цена:", "", {
    title: "Переоценка",
    inputMode: "decimal",
    placeholder: "Цена"
  });
  if (priceRaw === null) return;
  const price = Number(String(priceRaw).replace(",", "."));
  const comment =
    (await requestTextInput("Комментарий (необязательно):", "", { title: "Переоценка" })) || "";

  try {
    const res = await fetch(`/api/products/${productId}/reprice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price, comment })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка переоценки");

    showToast(`Новая цена: ${formatMoney(data.price)}`);
    await loadProducts();
  } catch (err) {
    showToast(err.message);
  }
}

addProductForm.addEventListener("submit", addProduct);
importBtn.addEventListener("click", importProducts);
addCategoryBtn.addEventListener("click", addCategory);
newCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addCategory();
});
inventorySearchInput.addEventListener("input", renderProducts);
refreshInventoryBtn.addEventListener("click", () =>
  Promise.all([loadProducts(), loadCategories()]).catch((e) => showToast(e.message))
);

editProductForm.addEventListener("submit", saveEditProduct);
editCancelBtn.addEventListener("click", closeEditModal);
editProductModal.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-edit-modal")) closeEditModal();
});
document.addEventListener("keydown", (event) => {
  if (editProductModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeEditModal();
});

Promise.all([loadProducts(), loadCategories()]).catch((err) => showToast(err.message));

