const state = {
  products: [],
  cartSessions: [],
  activeCartId: null,
  report: null,
  lastSale: null,
  clients: [],
  selectedCategory: "all",
  selectedPaymentType: "cash"
};

const productsList = document.getElementById("productsList");
const categoryList = document.getElementById("categoryList");
const cartList = document.getElementById("cartList");
const totalValue = document.getElementById("totalValue");
const searchInput = document.getElementById("searchInput");
const sellBtn = document.getElementById("sellBtn");
const cardBtn = document.getElementById("cardBtn");
const debtBtn = document.getElementById("debtBtn");
const printBtn = document.getElementById("printBtn");
const resetBtn = document.getElementById("resetBtn");
const shiftStatus = document.getElementById("shiftStatus");
const toast = document.getElementById("toast");
const addItemModal = document.getElementById("addItemModal");
const modalTitle = document.getElementById("modalTitle");
const modalQtyInput = document.getElementById("modalQtyInput");
const modalPriceInput = document.getElementById("modalPriceInput");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalSaveBtn = document.getElementById("modalSaveBtn");
const cashModal = document.getElementById("cashModal");
const cashTotalValue = document.getElementById("cashTotalValue");
const cashReceivedInput = document.getElementById("cashReceivedInput");
const cashChangeValue = document.getElementById("cashChangeValue");
const cashCloseBtn = document.getElementById("cashCloseBtn");
const cashConfirmBtn = document.getElementById("cashConfirmBtn");
const cashExactBtn = document.getElementById("cashExactBtn");
const autoPrintToggle = document.getElementById("autoPrintToggle");
const debtModal = document.getElementById("debtModal");
const debtClientSearchInput = document.getElementById("debtClientSearchInput");
const debtClientResults = document.getElementById("debtClientResults");
const debtClientNameInput = document.getElementById("debtClientNameInput");
const debtClientPhoneInput = document.getElementById("debtClientPhoneInput");
const debtCloseBtn = document.getElementById("debtCloseBtn");
const debtConfirmBtn = document.getElementById("debtConfirmBtn");
const debtModalTitle = debtModal?.querySelector("h3");
const saleClientInput = document.getElementById("saleClientInput");
const saleClientResults = document.getElementById("saleClientResults");
const saleCommentInput = document.getElementById("saleCommentInput");
const cartSlots = document.getElementById("cartSlots");
const newCartBtn = document.getElementById("newCartBtn");
const closeCartBtn = document.getElementById("closeCartBtn");

let pendingProduct = null;
const AUTO_PRINT_KEY = "kassa.autoPrintReceipt";
const SALE_DRAFT_KEY = "kassa.saleDraft";
const MAX_CART_SESSIONS = 5;
let selectedDebtClientId = null;
let debtModalMode = "sale";
let selectedSaleClientId = null;

function formatCommentPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 11) return text;
  if (text.replace(/[+\d\s()-]/g, "") !== "") return text;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

function createCartSession(order = 1, overrides = {}) {
  return {
    id: String(overrides.id || `cart-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`),
    label: String(overrides.label || `Клиент ${order}`),
    cart: Array.isArray(overrides.cart) ? overrides.cart : [],
    comment: String(overrides.comment || ""),
    clientId: overrides.clientId ? Number(overrides.clientId) : null,
    reservedSaleCode: String(overrides.reservedSaleCode || ""),
    updatedAt: Number(overrides.updatedAt || Date.now())
  };
}

function defaultSessionLabel(sessionId) {
  const index = state.cartSessions.findIndex((s) => s.id === sessionId);
  return `Клиент ${index >= 0 ? index + 1 : 1}`;
}

function updateActiveSessionLabel(value) {
  const session = getActiveCartSession();
  const next = String(value || "").trim();
  session.label = next || defaultSessionLabel(session.id);
  session.updatedAt = Date.now();
  renderCartSessions();
}

function getActiveCartSession() {
  let session = state.cartSessions.find((s) => s.id === state.activeCartId);
  if (!session) {
    if (state.cartSessions.length === 0) {
      session = createCartSession(1);
      state.cartSessions.push(session);
    } else {
      session = state.cartSessions[0];
    }
    state.activeCartId = session.id;
  }
  return session;
}

function syncActiveCommentToSession() {
  const session = getActiveCartSession();
  session.comment = formatCommentPhone(String(saleCommentInput?.value || "")).slice(0, 120);
  session.updatedAt = Date.now();
}

function syncActiveClientToSession() {
  const session = getActiveCartSession();
  session.clientId = selectedSaleClientId ? Number(selectedSaleClientId) : null;
  session.updatedAt = Date.now();
}

function loadActiveSessionToUI() {
  const session = getActiveCartSession();
  if (saleCommentInput) saleCommentInput.value = session.comment || "";
  selectedSaleClientId = session.clientId ? Number(session.clientId) : null;
  if (saleClientInput) {
    const client = getSelectedClient();
    saleClientInput.value = client ? formatClientLabel(client) : "Частное лицо";
  }
}

Object.defineProperty(state, "cart", {
  get() {
    return getActiveCartSession().cart;
  },
  set(value) {
    const session = getActiveCartSession();
    session.cart = Array.isArray(value) ? value : [];
    session.updatedAt = Date.now();
  },
  configurable: false,
  enumerable: true
});

if (state.cartSessions.length === 0) {
  const firstSession = createCartSession(1);
  state.cartSessions.push(firstSession);
  state.activeCartId = firstSession.id;
}

function saveSaleDraft() {
  try {
    syncActiveCommentToSession();
    syncActiveClientToSession();
    const normalizedSessions = state.cartSessions
      .map((session, idx) => {
        const cart = Array.isArray(session.cart) ? session.cart : [];
        const safeCart = cart
          .map((item) => ({
            rowId: String(item.rowId || `${item.productId || "draft"}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
            productId: String(item.productId || ""),
            name: String(item.name || "").trim(),
            price: Number(item.price),
            qty: Number(item.qty),
            unit: String(item.unit || "шт"),
            priceOnly: Boolean(item.priceOnly)
          }))
          .filter(
            (item) =>
              item.name &&
              Number.isFinite(item.price) &&
              item.price > 0 &&
              Number.isFinite(item.qty) &&
              item.qty > 0
          );

        const comment = formatCommentPhone(String(session.comment || "")).slice(0, 120);
        return createCartSession(idx + 1, {
          id: session.id,
          label: session.label || `Клиент ${idx + 1}`,
          cart: safeCart,
          comment,
          clientId: session.clientId ? Number(session.clientId) : null,
          reservedSaleCode: session.reservedSaleCode || "",
          updatedAt: session.updatedAt || Date.now()
        });
      })
      .filter((session) => session.cart.length > 0 || session.comment);

    if (normalizedSessions.length === 0) {
      localStorage.removeItem(SALE_DRAFT_KEY);
      return;
    }

    const activeCartId = normalizedSessions.some((s) => s.id === state.activeCartId)
      ? state.activeCartId
      : normalizedSessions[0].id;

    const draft = { version: 2, activeCartId, carts: normalizedSessions };
    localStorage.setItem(SALE_DRAFT_KEY, JSON.stringify(draft));
  } catch (_) {
    // ignore draft save errors
  }
}

function restoreSaleDraft() {
  try {
    const raw = localStorage.getItem(SALE_DRAFT_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    const cartsRaw = Array.isArray(parsed?.carts)
      ? parsed.carts
      : [
          {
            id: "legacy-1",
            label: "Клиент 1",
            cart: Array.isArray(parsed?.cart) ? parsed.cart : [],
            comment: String(parsed?.comment || ""),
            clientId: parsed?.clientId ? Number(parsed.clientId) : null
          }
        ];

    const safeSessions = cartsRaw
      .slice(0, MAX_CART_SESSIONS)
      .map((session, idx) => {
        const cart = Array.isArray(session?.cart) ? session.cart : [];
        const safeCart = cart
          .map((item) => ({
            rowId: String(item?.rowId || `${item?.productId || "draft"}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
            productId: String(item?.productId || ""),
            name: String(item?.name || "").trim(),
            price: Number(item?.price),
            qty: Number(item?.qty),
            unit: String(item?.unit || "шт"),
            priceOnly: Boolean(item?.priceOnly)
          }))
          .filter(
            (item) =>
              item.name &&
              Number.isFinite(item.price) &&
              item.price > 0 &&
              Number.isFinite(item.qty) &&
              item.qty > 0
          );

        return createCartSession(idx + 1, {
          id: session?.id,
          label: session?.label || `Клиент ${idx + 1}`,
          cart: safeCart,
          comment: formatCommentPhone(String(session?.comment || "")).slice(0, 120),
          clientId: session?.clientId ? Number(session.clientId) : null,
          reservedSaleCode: session?.reservedSaleCode || "",
          updatedAt: Number(session?.updatedAt || Date.now())
        });
      })
      .filter((session) => session.cart.length > 0 || session.comment);

    if (safeSessions.length === 0) {
      localStorage.removeItem(SALE_DRAFT_KEY);
      return false;
    }

    state.cartSessions = safeSessions;
    state.activeCartId =
      safeSessions.find((s) => s.id === parsed?.activeCartId)?.id || safeSessions[0].id;
    loadActiveSessionToUI();
    return true;
  } catch (_) {
    localStorage.removeItem(SALE_DRAFT_KEY);
    return false;
  }
}

async function reserveSaleCodeForSession(session) {
  if (!session || session.reservedSaleCode) return session?.reservedSaleCode || "";
  const res = await fetch("/api/sales/reserve", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Не удалось получить номер чека");
  }
  session.reservedSaleCode = String(data.saleCode || "");
  saveSaleDraft();
  return session.reservedSaleCode;
}

function isDeliveryProduct(product) {
  const name = String(product?.name || "").trim().toLowerCase();
  const category = String(product?.category || "").trim().toLowerCase();
  return category === "доставка" || name === "доставка";
}

function isDeliveryCartItem(item) {
  const name = String(item?.name || "").trim().toLowerCase();
  return name === "доставка" || item?.priceOnly === true;
}

function sortCartItemsForDisplay(items) {
  return [...items].sort((a, b) => {
    const aDelivery = isDeliveryCartItem(a);
    const bDelivery = isDeliveryCartItem(b);
    if (aDelivery && !bDelivery) return 1;
    if (!aDelivery && bDelivery) return -1;
    return 0;
  });
}

function renderCartSessions() {
  if (!cartSlots) return;
  const activeId = getActiveCartSession().id;

  cartSlots.innerHTML = state.cartSessions
    .map((session) => {
      const total = session.cart.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.qty || 0), 0);
      const activeClass = session.id === activeId ? "is-active" : "";
      return `
        <button type="button" class="btn cart-slot-btn ${activeClass}" data-cart-id="${session.id}">
          <span class="cart-slot-label">${session.label}</span>
          <span class="cart-slot-total">${formatMoney(total)}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-cart-id]").forEach((btn) => {
    btn.addEventListener("click", () => switchCartSession(btn.dataset.cartId));
  });

  if (closeCartBtn) closeCartBtn.disabled = state.cartSessions.length <= 1;
  if (newCartBtn) newCartBtn.disabled = state.cartSessions.length >= MAX_CART_SESSIONS;
}

function switchCartSession(cartId) {
  const target = state.cartSessions.find((s) => s.id === cartId);
  if (!target) return;
  syncActiveCommentToSession();
  syncActiveClientToSession();
  state.activeCartId = target.id;
  loadActiveSessionToUI();
  renderCart();
  focusSearchInput(false);
}

function createNewCartSession() {
  syncActiveCommentToSession();
  if (state.cartSessions.length >= MAX_CART_SESSIONS) {
    showToast(`Максимум ${MAX_CART_SESSIONS} корзин`);
    return;
  }
  const nextOrder = state.cartSessions.length + 1;
  const session = createCartSession(nextOrder, { label: `Клиент ${nextOrder}` });
  state.cartSessions.push(session);
  state.activeCartId = session.id;
  loadActiveSessionToUI();
  renderCart();
  showToast(`Открыта корзина: ${session.label}`);
}

async function closeCurrentCartSession() {
  syncActiveCommentToSession();
  const current = getActiveCartSession();
  if (state.cartSessions.length <= 1) {
    resetCart();
    return;
  }

  if (current.cart.length > 0 || current.comment) {
    const ok = await requestConfirm(`Закрыть ${current.label} и удалить ее товары?`, {
      title: "Закрытие корзины",
      yesText: "Закрыть",
      noText: "Отмена"
    });
    if (!ok) return;
  }

  const idx = state.cartSessions.findIndex((s) => s.id === current.id);
  state.cartSessions.splice(idx, 1);
  const next = state.cartSessions[Math.max(0, idx - 1)] || state.cartSessions[0];
  state.activeCartId = next.id;
  loadActiveSessionToUI();
  renderCart();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function restoreMainFocus() {
  setTimeout(() => {
    try {
      window.focus();
    } catch (_) {
      // no-op
    }
    focusSearchInput(false);
  }, 0);
}

function requestConfirm(message, options = {}) {
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
    title.textContent = options.title || "Подтверждение";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "20px";

    const text = document.createElement("div");
    text.textContent = message || "";
    text.style.color = "#4d6075";
    text.style.marginBottom = "10px";
    text.style.whiteSpace = "pre-line";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";

    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "btn";
    noBtn.textContent = options.noText || "Нет";

    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "btn primary";
    yesBtn.textContent = options.yesText || "Да";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      overlay.remove();
      restoreMainFocus();
      resolve(value);
    };

    noBtn.addEventListener("click", () => finish(false));
    yesBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    });

    actions.append(noBtn, yesBtn);
    card.append(title, text, actions);
    overlay.append(card);
    document.body.append(overlay);
    overlay.tabIndex = -1;
    overlay.focus();
  });
}

function formatMoney(value) {
  const amount = Math.round(Number(value || 0));
  return `${amount.toLocaleString("ru-RU")} т`;
}

function formatNumber(value) {
  const amount = Math.round(Number(value || 0));
  return amount.toLocaleString("ru-RU");
}

function formatQtyUnit(qty, unit) {
  const num = Number(qty || 0);
  const qtyText = Number.isInteger(num) ? String(num) : String(num).replace(/\.?0+$/, "");
  return `${qtyText} ${unit || "шт"}`;
}

function paymentTypeLabel(type) {
  if (type === "card") return "Карта";
  if (type === "debt") return "В долг";
  return "Наличные";
}

function getSelectedClient() {
  const sessionClientId = getActiveCartSession().clientId;
  if (!sessionClientId) return null;
  return state.clients.find((c) => Number(c.id) === Number(sessionClientId)) || null;
}

function isAutoPrintEnabled() {
  return localStorage.getItem(AUTO_PRINT_KEY) !== "0";
}

function setAutoPrintEnabled(enabled) {
  localStorage.setItem(AUTO_PRINT_KEY, enabled ? "1" : "0");
}

function isAnyModalOpen() {
  return (
    !addItemModal.classList.contains("hidden") ||
    !cashModal.classList.contains("hidden") ||
    !debtModal.classList.contains("hidden")
  );
}

function focusSearchInput(selectAll = false) {
  if (isAnyModalOpen()) return;
  if (document.activeElement !== searchInput) {
    searchInput.focus();
  }
  if (selectAll && searchInput.value) {
    searchInput.select();
  }
}

function bindSelectAllOnFocus(input) {
  if (!input) return;

  const selectAll = () => {
    try {
      input.select();
    } catch (_) {
      // no-op
    }
  };

  input.addEventListener("focus", () => {
    setTimeout(selectAll, 0);
  });
  input.addEventListener("click", () => {
    setTimeout(selectAll, 0);
  });
  input.addEventListener("mouseup", (event) => {
    event.preventDefault();
    setTimeout(selectAll, 0);
  });
}

function cartTotal() {
  return state.cart.reduce((acc, item) => acc + item.price * item.qty, 0);
}

function getProductCategory(product) {
  return product.category || "Без категории";
}

function normalizeCategoryName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[xх×*]/g, "*")
    .replace(/\s+/g, "");
}

function normalizeProductSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[xх×*]/g, "*")
    .replace(/[^\p{L}\p{N}* ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAlphaNumParts(value) {
  return String(value || "").match(/[\p{L}*]+|\d+/gu) || [];
}

function productMatchesSearch(productName, queryRaw) {
  const queryText = normalizeProductSearchText(queryRaw);
  if (!queryText) return true;

  const nameText = normalizeProductSearchText(productName);
  if (!nameText) return false;

  const queryCompact = queryText.replace(/\s+/g, "");
  const nameCompact = nameText.replace(/\s+/g, "");
  if (nameCompact.includes(queryCompact)) return true;

  const nameTokens = nameText.split(" ");
  const queryTokens = queryText.split(" ");
  const allTokensMatch = queryTokens.every((qToken) =>
    nameTokens.some((nToken) => nToken.includes(qToken) || nToken.startsWith(qToken))
  );
  if (allTokensMatch) return true;

  const queryParts = splitAlphaNumParts(queryCompact);
  const nameParts = splitAlphaNumParts(nameCompact);
  if (!queryParts.length || !nameParts.length) return false;

  let j = 0;
  for (let i = 0; i < queryParts.length; i += 1) {
    const qPart = queryParts[i];
    let found = false;
    for (; j < nameParts.length; j += 1) {
      const nPart = nameParts[j];
      const qIsDigits = /^\d+$/.test(qPart);
      const matches = qIsDigits
        ? nPart.includes(qPart)
        : nPart.startsWith(qPart) || nPart.includes(qPart);
      if (matches) {
        found = true;
        j += 1;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function renderCategories() {
  const grouped = state.products.reduce((acc, product) => {
    const category = getProductCategory(product);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const aIsDelivery = a.trim().toLowerCase() === "доставка";
    const bIsDelivery = b.trim().toLowerCase() === "доставка";
    if (aIsDelivery && !bIsDelivery) return 1;
    if (!aIsDelivery && bIsDelivery) return -1;
    return a.localeCompare(b, "ru");
  });
  const categories = ["all", ...sortedCategories];

  categoryList.innerHTML = categories
    .map((category) => {
      const label = category === "all" ? "Все товары" : category;
      const active = state.selectedCategory === category ? "is-active" : "";
      const count = category === "all" ? state.products.length : grouped[category];
      return `<button class="btn category-btn ${active}" data-category="${category}">${label} <span class="category-count">${count}</span></button>`;
    })
    .join("");

  document.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedCategory = btn.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const q = String(searchInput.value || "");
  const list = state.products.filter((p) => {
    const inCategory = q
      ? true
      : state.selectedCategory === "all" || getProductCategory(p) === state.selectedCategory;
    const inSearch = productMatchesSearch(p.name, q);
    return inCategory && inSearch;
  });

  if (list.length === 0) {
    productsList.innerHTML = "<p class=\"muted\">По вашему запросу товары не найдены.</p>";
    return;
  }

  productsList.innerHTML = `
    <div class="products-list">
      ${list
        .map(
          (p) => `
            <div class="product-row" data-row-add="${p.id}">
              <div class="product-name">${p.name}</div>
              <div class="product-stock">${p.category || "Без категории"}</div>
              <div class="product-price">${formatMoney(Number(p.price))}</div>
              <button class="btn product-buy" data-add="${p.id}">Купить</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;

  document.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => addToCart(btn.dataset.add));
  });

  document.querySelectorAll("[data-row-add]").forEach((row) => {
    row.addEventListener("dblclick", () => addToCart(row.dataset.rowAdd));
  });
}

function renderCart() {
  renderCartSessions();
  if (state.cart.length === 0) {
    cartList.innerHTML = "<p class=\"muted\">В чеке пока нет товаров.</p>";
  } else {
    const cartItems = sortCartItemsForDisplay(state.cart);
    cartList.innerHTML = `
      <div class="cart-columns-head">
        <span>Товар</span>
        <span>Кол-во x Цена = Итог</span>
      </div>
      ${cartItems
        .map(
          (item) => `
          <div class="cart-item">
            <div class="cart-meta">
              <strong>${item.name}</strong>
              ${
                item.priceOnly
                  ? `<div class="cart-line-grid"><span class="cart-col price">${formatMoney(item.price)}</span></div>`
                  : `<div class="cart-line-grid">
                      <input class="cart-qty-input" type="number" step="0.001" min="0.001" value="${item.qty}" data-qty-input="${item.rowId}" />
                      <span class="cart-col sign">x</span>
                      <div class="cart-price-wrap">
                        <input class="cart-price-input" type="number" step="0.01" min="0.01" value="${item.price}" data-price-input="${item.rowId}" />
                      </div>
                      <span class="cart-col sign">т</span>
                      <span class="cart-col sign">=</span>
                      <span class="cart-col sum">${formatMoney(item.qty * item.price)}</span>
                    </div>`
              }
            </div>
            <div class="cart-controls">
              <button class="btn small" data-remove="${item.rowId}">Удалить</button>
            </div>
          </div>
        `
        )
        .join("")}
    `;

    document.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeCartItem(btn.dataset.remove));
    });

    document.querySelectorAll("[data-qty-input]").forEach((input) => {
      input.addEventListener("focus", () => {
        input.select();
      });
      input.addEventListener("click", () => {
        input.select();
      });
      input.addEventListener("mouseup", (event) => {
        event.preventDefault();
        input.select();
      });
      input.addEventListener("change", () => setQty(input.dataset.qtyInput, input.value));
      input.addEventListener("blur", () => setQty(input.dataset.qtyInput, input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setQty(input.dataset.qtyInput, input.value);
        }
      });
    });

    document.querySelectorAll("[data-price-input]").forEach((input) => {
      input.addEventListener("focus", () => {
        input.select();
      });
      input.addEventListener("click", () => {
        input.select();
      });
      input.addEventListener("mouseup", (event) => {
        event.preventDefault();
        input.select();
      });
      input.addEventListener("change", () => setPrice(input.dataset.priceInput, input.value));
      input.addEventListener("blur", () => setPrice(input.dataset.priceInput, input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setPrice(input.dataset.priceInput, input.value);
        }
      });
    });
  }

  totalValue.textContent = formatMoney(cartTotal());
  syncActiveCommentToSession();
  saveSaleDraft();
}

function openAddModal(product) {
  pendingProduct = product;
  const deliveryOnlyPrice = isDeliveryProduct(product);
  const minPrice = Number(product.minPrice || 0);
  modalTitle.textContent = `Добавить: ${product.name}`;
  modalQtyInput.value = "1";
  modalPriceInput.value = String(product.price);
  if (modalPriceLabel) {
    modalPriceLabel.textContent = Number.isFinite(minPrice) && minPrice > 0
      ? `Цена за шт. (Мин. цена: ${formatMoney(minPrice)})`
      : "Цена за шт.";
  }
  const qtyField = modalQtyInput.closest(".field");
  qtyField.classList.toggle("hidden", deliveryOnlyPrice);
  modalQtyInput.disabled = deliveryOnlyPrice;
  addItemModal.classList.remove("hidden");
  if (deliveryOnlyPrice) {
    modalPriceInput.focus();
    modalPriceInput.select();
  } else {
    modalQtyInput.focus();
    modalQtyInput.select();
  }
}

function closeAddModal() {
  addItemModal.classList.add("hidden");
  pendingProduct = null;
  focusSearchInput(false);
}

function submitAddModal() {
  if (!pendingProduct) return;

  const deliveryOnlyPrice = isDeliveryProduct(pendingProduct);
  const qty = deliveryOnlyPrice ? 1 : Number(String(modalQtyInput.value).replace(",", "."));
  const price = Number(String(modalPriceInput.value).replace(",", "."));

  if (!Number.isFinite(qty) || qty <= 0) {
    showToast("Количество должно быть больше 0");
    return;
  }

  if (!Number.isFinite(price) || price <= 0) {
    showToast("Цена должна быть больше 0");
    return;
  }

  const product = pendingProduct;
  const normalizedPrice = Number(price.toFixed(2));
  const normalizedQty = Number(qty.toFixed(3));

  const priceKey = normalizedPrice.toFixed(2);
  const existing = state.cart.find(
    (item) => item.productId === product.id && item.price.toFixed(2) === priceKey
  );

  if (existing) {
    if (!existing.priceOnly) existing.qty = Number((existing.qty + normalizedQty).toFixed(3));
  } else {
    state.cart.push({
      rowId: `${product.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      productId: product.id,
      name: product.name,
      price: normalizedPrice,
      qty: normalizedQty,
      unit: product.unit || "шт",
      priceOnly: deliveryOnlyPrice
    });
  }

  renderCart();
  closeAddModal();
}

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  openAddModal(product);
}

function removeCartItem(rowId) {
  const index = state.cart.findIndex((item) => item.rowId === rowId);
  if (index === -1) return;
  state.cart.splice(index, 1);
  renderCart();
  // Restore focus to search input after cart update
  focusSearchInput();
}

function changeQty(rowId, diff) {
  const index = state.cart.findIndex((item) => item.rowId === rowId);
  if (index === -1) return;

  const item = state.cart[index];
  item.qty += diff;

  if (item.qty <= 0) {
    state.cart.splice(index, 1);
  }

  renderCart();
  // Restore focus to search input after cart update
  focusSearchInput();
}

function setQty(rowId, nextValue) {
  const index = state.cart.findIndex((item) => item.rowId === rowId);
  if (index === -1) return;
  const qty = Number(String(nextValue).replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0) {
    showToast("Количество должно быть больше 0");
    return;
  }
  state.cart[index].qty = Number(qty.toFixed(3));
  renderCart();
  focusSearchInput();
}

function setPrice(rowId, nextValue) {
  const index = state.cart.findIndex((item) => item.rowId === rowId);
  if (index === -1) return;
  const price = Number(String(nextValue).replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    showToast("Цена должна быть больше 0");
    return;
  }
  state.cart[index].price = Number(price.toFixed(2));
  renderCart();
  focusSearchInput();
}

async function loadProducts() {
  const res = await fetch("/api/products");
  state.products = await res.json();
  renderCategories();
  renderProducts();
}

async function loadClients(search = "") {
  const params = new URLSearchParams({ limit: "200" });
  const res = await fetch(`/api/clients?${params.toString()}`);
  if (!res.ok) throw new Error("Не удалось загрузить клиентов");
  const list = await res.json();
  const q = normalizeSearchText(search);
  state.clients = q
    ? list.filter((client) => {
        const name = normalizeSearchText(client.name);
        const phone = normalizeSearchText(client.phone);
        return name.includes(q) || phone.includes(q);
      })
    : list;
  renderSaleClientResults();
}

function formatClientLabel(client) {
  return client.phone ? `${client.name} (${client.phone})` : client.name;
}

function renderSaleClientResults() {
  if (!saleClientResults || !saleClientInput) return;
  const hasQuery = String(saleClientInput.value || "").trim().length > 0;
  saleClientResults.classList.toggle("hidden", !hasQuery);
  if (!hasQuery) {
    saleClientResults.innerHTML = "";
    return;
  }
  if (!state.clients.length) {
    saleClientResults.innerHTML = "<div class=\"debt-client-result muted\">Клиенты не найдены</div>";
    return;
  }
  saleClientResults.innerHTML = state.clients
    .map((client) => {
      const active = Number(selectedSaleClientId) === Number(client.id) ? "is-active" : "";
      return `
        <button type="button" class="debt-client-result ${active}" data-sale-client-id="${client.id}">
          <span>${client.name}</span>
          <span class="muted">${client.phone || ""}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-sale-client-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clientId = Number(btn.dataset.saleClientId);
      const client = state.clients.find((c) => Number(c.id) === clientId);
      selectedSaleClientId = clientId;
      saleClientInput.value = client ? formatClientLabel(client) : "Частное лицо";
      updateActiveSessionLabel(client ? client.name : "");
      renderSaleClientResults();
      saleClientResults.classList.add("hidden");
      syncActiveClientToSession();
      saveSaleDraft();
    });
  });
}

function renderDebtClientResults() {
  if (!debtClientResults) return;
  const hasQuery = String(debtClientSearchInput?.value || "").trim().length > 0;
  debtClientResults.classList.toggle("hidden", !hasQuery);
  if (!hasQuery) {
    debtClientResults.innerHTML = "";
    return;
  }
  if (!state.clients.length) {
    debtClientResults.innerHTML = "<div class=\"debt-client-result muted\">Клиенты не найдены</div>";
    return;
  }
  debtClientResults.innerHTML = state.clients
    .map((client) => {
      const active = Number(client.id) === Number(selectedDebtClientId) ? "is-active" : "";
      return `
        <button type="button" class="debt-client-result ${active}" data-debt-client-id="${client.id}">
          <span>${client.name}</span>
          <span class="muted">${client.phone || ""}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-debt-client-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clientId = Number(btn.dataset.debtClientId);
      const client = state.clients.find((c) => Number(c.id) === clientId);
      selectedDebtClientId = clientId;
      debtClientSearchInput.value = client?.name || debtClientSearchInput.value;
      renderDebtClientResults();
      debtClientResults.classList.add("hidden");
    });
  });
}

function renderReport() {
  if (!state.report) return;
  if (!shiftStatus) return;

  shiftStatus.innerHTML = state.report.shift.isOpen
    ? `Смена открыта: ${new Date(state.report.shift.openedAt).toLocaleString()}`
    : "Смена закрыта";
}

async function loadReport() {
  const res = await fetch("/api/reports/x");
  state.report = await res.json();
  renderReport();
}

async function checkout(paymentType = state.selectedPaymentType, options = {}) {
  if (state.cart.length === 0) {
    showToast("Добавьте товары в чек");
    return false;
  }

  const cashier = state.report?.shift?.cashier || "Кассир 1";
  const comment = formatCommentPhone(saleCommentInput?.value).slice(0, 120);
  const session = getActiveCartSession();
  const sessionClientId = session.clientId;
  const clientId = options.clientId ? Number(options.clientId) : sessionClientId ? Number(sessionClientId) : null;

  const cartItems = sortCartItemsForDisplay(state.cart);

  sellBtn.disabled = true;
  cardBtn.disabled = true;
  if (debtBtn) debtBtn.disabled = true;

  try {
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cashier,
        paymentType,
        clientId,
        comment,
        saleCode: session.reservedSaleCode || "",
        items: cartItems.map((item) => ({
          productId: item.productId,
          qty: item.qty,
          price: item.price
        }))
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Ошибка продажи");
    }

    const sale = await res.json();
    state.lastSale = sale;
    state.cart = [];
    getActiveCartSession().comment = "";
    getActiveCartSession().reservedSaleCode = "";
    const clearedSession = getActiveCartSession();
    clearedSession.clientId = null;
    selectedSaleClientId = null;
    if (saleClientInput) saleClientInput.value = "Частное лицо";
    updateActiveSessionLabel("");
    saveSaleDraft();
    printBtn.disabled = false;

    if (isAutoPrintEnabled()) {
      const printOk = await printReceiptSale(sale, false);
      if (printOk) {
        showToast(`Чек ${sale.id} создан и отправлен на печать`);
      } else {
        showToast(`Чек ${sale.id} создан, но печать не выполнена`);
      }
    } else {
      showToast(`Чек ${sale.id} успешно создан`);
    }

    await Promise.all([loadProducts(), loadReport()]);
    renderCart();
    if (saleCommentInput) saleCommentInput.value = "";
    saveSaleDraft();
    focusSearchInput(false);
    return true;
  } catch (err) {
    showToast(err.message);
    return false;
  } finally {
    sellBtn.disabled = false;
    cardBtn.disabled = false;
    if (debtBtn) debtBtn.disabled = false;
  }
}

function resetCart() {
  state.cart = [];
  const session = getActiveCartSession();
  session.comment = "";
  session.reservedSaleCode = "";
  if (saleCommentInput) saleCommentInput.value = "";
  renderCart();
  showToast("Чек очищен");
  focusSearchInput(false);
}

function parseCashReceived() {
  const normalized = String(cashReceivedInput.value || "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function renderCashModalValues() {
  const total = cartTotal();
  const received = parseCashReceived();
  const change = Math.max(received - total, 0);

  cashTotalValue.textContent = formatNumber(total);
  cashChangeValue.textContent = formatNumber(change);
  cashConfirmBtn.disabled = received < total || total <= 0;
}

function openCashModal() {
  if (state.cart.length === 0) {
    showToast("Добавьте товары в чек");
    return;
  }
  cashReceivedInput.value = "0";
  renderCashModalValues();
  cashModal.classList.remove("hidden");
  cashReceivedInput.focus();
  cashReceivedInput.select();
}

function closeCashModal() {
  cashModal.classList.add("hidden");
  focusSearchInput(false);
}

function setExactCashReceived() {
  const total = Math.round(cartTotal());
  cashReceivedInput.value = String(total > 0 ? total : 0);
  renderCashModalValues();
  cashReceivedInput.focus();
  cashReceivedInput.select();
}

function keypadInput(key) {
  const digits = String(cashReceivedInput.value || "").replace(/\D/g, "");
  if (key === "back") {
    const next = digits.slice(0, -1);
    cashReceivedInput.value = next.length ? String(Number(next)) : "0";
    renderCashModalValues();
    return;
  }

  const nextDigits = `${digits === "0" ? "" : digits}${key}`.slice(0, 9);
  cashReceivedInput.value = nextDigits.length ? String(Number(nextDigits)) : "0";
  renderCashModalValues();
}

async function confirmCashSale() {
  renderCashModalValues();
  if (cashConfirmBtn.disabled) {
    showToast("Получено меньше суммы чека");
    return;
  }
  const ok = await checkout("cash");
  if (ok) closeCashModal();
}

async function sellByCard() {
  if (state.cart.length === 0) {
    showToast("Добавьте товары в чек");
    return;
  }
  await checkout("card");
}

function openDebtModal(mode = "sale") {
  if (state.cart.length === 0) {
    showToast("Добавьте товары в чек");
    return;
  }
  debtModalMode = mode;
  if (debtModalTitle) {
    debtModalTitle.textContent = mode === "create" ? "Новый клиент" : "Продажа в долг";
  }
  if (debtConfirmBtn) {
    debtConfirmBtn.textContent = mode === "create" ? "Создать клиента" : "Оформить в долг";
  }
  debtClientSearchInput.value = "";
  selectedDebtClientId = null;
  debtClientNameInput.value = "";
  debtClientPhoneInput.value = "";
  loadClients("")
    .then(() => {
      debtClientResults.classList.add("hidden");
      renderDebtClientResults();
      debtModal.classList.remove("hidden");
      debtClientSearchInput.focus();
    })
    .catch((err) => showToast(err.message));
}

function closeDebtModal() {
  debtModal.classList.add("hidden");
  focusSearchInput(false);
}

function setSelectedClientById(clientId) {
  const client = state.clients.find((c) => Number(c.id) === Number(clientId)) || null;
  selectedSaleClientId = client ? Number(client.id) : null;
  if (saleClientInput) {
    saleClientInput.value = client ? formatClientLabel(client) : "Частное лицо";
  }
  updateActiveSessionLabel(client ? client.name : "");
  syncActiveClientToSession();
  saveSaleDraft();
}

async function confirmDebtSale() {
  try {
    debtConfirmBtn.disabled = true;
    let clientId = Number(selectedDebtClientId || 0);
    const newName = String(debtClientNameInput.value || "").trim();
    const newPhone = formatCommentPhone(String(debtClientPhoneInput.value || "").trim());

    if (debtModalMode === "sale" && !clientId && !newName && state.clients.length > 0) {
      clientId = Number(state.clients[0].id);
      selectedDebtClientId = clientId;
    }

    if (newName) {
      const createRes = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, phone: newPhone })
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || "Ошибка создания клиента");
      clientId = Number(created.id);
      selectedDebtClientId = clientId;
      await loadClients("");
      renderDebtClientResults();
    }

    if (!Number.isInteger(clientId) || clientId <= 0) {
      showToast("Выберите клиента или создайте нового");
      return;
    }

    const ok = await checkout("debt", { clientId });
    if (ok) {
      setSelectedClientById(clientId);
      closeDebtModal();
    }
  } catch (err) {
    showToast(err.message || "Ошибка продажи в долг");
  } finally {
    debtConfirmBtn.disabled = false;
  }
}

function openReceiptPreviewWindow(sale) {
  const soldAt = new Date(sale.createdAt);
  const docDate = soldAt.toLocaleDateString();
  const docTime = soldAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const formatPrintAmount = (value) =>
    String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  const esc = (v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const rows = sale.items
    .map((item, idx) => {
      const lineTotal = item.qty * item.price;
      const pricePrint = formatPrintAmount(item.price);
      const lineTotalPrint = formatPrintAmount(lineTotal);
      return `
        <tr>
          <td class="name">${idx + 1}. ${esc(item.name)}</td>
          <td class="qty">${esc(formatQtyUnit(item.qty, item.unit || "шт"))}</td>
          <td class="price">х ${pricePrint}</td>
          <td class="sum">= ${lineTotalPrint}</td>
        </tr>
      `;
    })
    .join("");

  const saleJson = JSON.stringify(sale).replace(/</g, "\\u003c");
  const receiptHtml = `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <title>Чек ${esc(sale.id)}</title>
        <style>
          @page { size: 80mm auto; margin: 2mm; }
          :root { --preview-scale: 1.5; }
          html, body { width: 100%; }
          body {
            margin: 0;
            font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
            font-size: 12px;
            line-height: 1.2;
            color: #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            text-rendering: geometricPrecision;
            background: #f2f5f8;
          }
          .preview-wrap {
            min-height: 100vh;
            padding: 22px;
            display: flex;
            justify-content: center;
            align-items: flex-start;
          }
          .receipt {
            width: 76mm;
            margin: 0 auto;
            padding: 2mm;
            background: #fff;
            border: 1px solid #d6e0ea;
            box-shadow: 0 8px 24px rgba(18, 32, 48, 0.12);
            transform: scale(var(--preview-scale));
            transform-origin: top center;
          }
          .center { text-align: center; }
          .bold { font-weight: 700; }
          .line { border-top: 1px dotted #777; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; vertical-align: top; }
          th { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: left; }
          .name { width: 52%; word-break: break-word; }
          .qty, .price, .sum { text-align: right; white-space: nowrap; width: 16%; }
          .totals { margin-top: 6px; }
          .totals-row { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; }
          .muted { color: #333; }
          .toolbar {
            position: sticky;
            top: 0;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            align-items: center;
            background: #f2f5f8;
            padding: 12px 22px 8px;
            border-bottom: 1px solid #d7e0e9;
            z-index: 2;
          }
          .toolbar button {
            border: 1px solid #c9d8ea;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 14px;
            cursor: pointer;
            background: #fff;
          }
          #zoomBtn { min-width: 92px; }
          .toolbar .primary {
            background: #0a76f6;
            color: #fff;
            border-color: #0a76f6;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button id="zoomBtn" title="Масштаб">150%</button>
          <button id="closeBtn">Закрыть</button>
            <button id="whatsappBtn">WhatsApp</button>
          <button id="saveJpegBtn">Скачать чек (JPEG)</button>
          <button id="sendEscPosBtn" class="primary">Отправить на принтер</button>
        </div>
        <div class="preview-wrap">
          <div class="receipt">
            <div class="center">Добро пожаловать</div>
            <div class="center bold">Мерос</div>
            <div class="center muted">Телефон: +7 (702) 913-13-39</div>
            <div class="line"></div>
            <div class="center bold">ЧЕК НА ПРОДАЖУ № ${esc(sale.id)}</div>
            <div class="center">от ${docDate} ${docTime}</div>
            <div class="line"></div>

            <table>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th class="qty">Кол-во</th>
                  <th class="price">Цена</th>
                  <th class="sum">Итог</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>

            <div class="line"></div>
            <div>Всего наименований: ${sale.items.length}</div>
            <div class="totals">
              <div class="totals-row">
                <span>ИТОГО:</span>
                <span>${formatPrintAmount(sale.total)} тенге</span>
              </div>
            </div>
            <div class="line"></div>
            <div>Кассир: ${esc(sale.cashier)}</div>
            <div>Оплата: ${paymentTypeLabel(sale.paymentType)}</div>
            ${
              sale.clientName
                ? `<div>Клиент: ${esc(sale.clientName)}${sale.clientPhone ? `, ${esc(sale.clientPhone)}` : ""}</div>`
                : ""
            }
            ${sale.comment ? `<div class="center bold">${esc(formatCommentPhone(sale.comment))}</div>` : ""}
            <div class="line"></div>
            <div class="center bold">СПАСИБО ЗА ПОКУПКУ!</div>
          </div>
        </div>
        <script src="/vendor/html2canvas.min.js"></script>
        <script>
          const sale = ${saleJson};
          const closeBtn = document.getElementById("closeBtn");
          const sendEscPosBtn = document.getElementById("sendEscPosBtn");
          const whatsappBtn = document.getElementById("whatsappBtn");
          const saveJpegBtn = document.getElementById("saveJpegBtn");
          const zoomBtn = document.getElementById("zoomBtn");
          const zoomLevels = [1.25, 1.5, 1.75];
          let zoomIndex = 2;
          const applyZoom = () => {
            const level = zoomLevels[zoomIndex];
            document.documentElement.style.setProperty("--preview-scale", String(level));
            zoomBtn.textContent = Math.round(level * 100) + "%";
          };
          applyZoom();

          closeBtn.addEventListener("click", () => window.close());
          zoomBtn.addEventListener("click", () => {
            zoomIndex = (zoomIndex + 1) % zoomLevels.length;
            applyZoom();
          });
          const formatAmount = (value) =>
            String(Math.round(Number(value || 0))).replace(/\\B(?=(\\d{3})+(?!\\d))/g, " ");
          const formatQty = (value) => {
            const num = Number(value || 0);
            if (Number.isInteger(num)) return String(num);
            return String(num).replace(/\\.?0+$/, "");
          };
          const normalizePhone = (raw) => {
            const digits = String(raw || "").replace(/\\D/g, "");
            if (!digits) return "";
            if (digits.length === 11) return digits;
            if (digits.length === 10) return "7" + digits;
            return digits;
          };
          const extractPhoneFromText = (text) => {
            const digits = String(text || "").replace(/\\D/g, "");
            if (digits.length >= 11) return digits.slice(0, 11);
            if (digits.length === 10) return "7" + digits;
            return "";
          };
          whatsappBtn.addEventListener("click", () => {
            const phone =
              normalizePhone(sale.clientPhone) || extractPhoneFromText(sale.comment);
            if (!phone) {
              alert("У клиента нет телефона.");
              return;
            }
            const url = "https://wa.me/" + phone;
              window.open(url, "_blank");
            });
          saveJpegBtn.addEventListener("click", async () => {
            saveJpegBtn.disabled = true;
            try {
              if (typeof html2canvas !== "function") {
                throw new Error("html2canvas не загружен");
              }
              const receipt = document.querySelector(".receipt");
               const prevWidth = receipt.style.width;
               const prevHeight = receipt.style.height;
               const prevScale = document.documentElement.style.getPropertyValue("--preview-scale");
               // Reset scale to 1 before screenshot
               document.documentElement.style.setProperty("--preview-scale", "1");
               // Wait for reflow
               await new Promise(r => setTimeout(r, 50));
               receipt.style.width = receipt.scrollWidth + "px";
               receipt.style.height = receipt.scrollHeight + "px";
               const canvas = await html2canvas(receipt, {
                 scale: 2,
                 backgroundColor: "#ffffff",
                 width: receipt.scrollWidth,
                 height: receipt.scrollHeight
               });
               receipt.style.width = prevWidth;
               receipt.style.height = prevHeight;
               document.documentElement.style.setProperty("--preview-scale", prevScale);
               const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
              const pad2 = (v) => String(v).padStart(2, "0");
              const stamp = new Date(sale.createdAt || Date.now());
              const datePart = stamp.getFullYear() + "-" + pad2(stamp.getMonth() + 1) + "-" + pad2(stamp.getDate());
              const timePart = pad2(stamp.getHours()) + "-" + pad2(stamp.getMinutes()) + "-" + pad2(stamp.getSeconds());
              const fileName =
                (sale.clientName ? sale.clientName : "Чек") + " " + datePart + " " + timePart;
              const res = await fetch("/api/receipt/save-jpeg", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl, fileName })
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Ошибка сохранения JPEG");
              alert("JPEG сохранен: " + (data.fileName || "Чек.jpeg"));
            } catch (err) {
              alert(err.message || "Ошибка сохранения JPEG");
            } finally {
              saveJpegBtn.disabled = false;
            }
          });
          sendEscPosBtn.addEventListener("click", async () => {
            sendEscPosBtn.disabled = true;
            try {
              const res = await fetch("/api/print/receipt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sale })
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Ошибка отправки на принтер");
              alert("Чек отправлен на принтер");
            } catch (err) {
              alert(err.message || "Ошибка печати");
            } finally {
              sendEscPosBtn.disabled = false;
            }
          });
        </script>
      </body>
    </html>
  `;

  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
  const width = Math.max(420, Math.floor(viewportWidth * 0.75));
  const height = Math.max(520, Math.floor(viewportHeight * 0.75));
  const left = Math.max(0, Math.floor(dualScreenLeft + (viewportWidth - width) / 2));
  const top = Math.max(0, Math.floor(dualScreenTop + (viewportHeight - height) / 2));
  const features = `width=${width},height=${height},left=${left},top=${top}`;
  const w = window.open("", "receiptPreview", features);
  w.document.open();
  w.document.write(receiptHtml);
  w.document.close();
  w.focus();
}

async function printReceiptSale(sale, showSuccessToast = true) {
  try {
    const res = await fetch("/api/print/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sale })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Не удалось отправить на принтер");
    }

    if (showSuccessToast) {
      showToast("Чек отправлен на печать");
    }
    return true;
  } catch (err) {
    showToast(`Ошибка печати: ${err.message}`);
    return false;
  }
}

async function printLastReceipt() {
  let sale = null;

  if (state.cart.length > 0) {
    const cartItems = sortCartItemsForDisplay(state.cart);
    const selectedClient = getSelectedClient();
    const session = getActiveCartSession();
    let reservedCode = session.reservedSaleCode;
    if (!reservedCode) {
      try {
        reservedCode = await reserveSaleCodeForSession(session);
      } catch (err) {
        showToast(err.message || "Не удалось получить номер чека");
        return;
      }
    }
    sale = {
      id: reservedCode,
      createdAt: new Date().toISOString(),
      cashier: state.report?.shift?.cashier || "Кассир 1",
      paymentType: state.selectedPaymentType || "cash",
      total: Number(cartTotal().toFixed(2)),
      comment: formatCommentPhone(saleCommentInput?.value).slice(0, 120),
      clientId: selectedClient ? Number(selectedClient.id) : null,
      clientName: selectedClient ? selectedClient.name : "",
      clientPhone: selectedClient ? selectedClient.phone || "" : "",
      items: cartItems.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.unit || "шт",
        price: item.price
      }))
    };
  } else if (state.lastSale) {
    sale = state.lastSale;
  } else {
    showToast("В чеке нет товаров для печати");
    return;
  }

  openReceiptPreviewWindow(sale);
}

searchInput.addEventListener("input", renderProducts);
saleCommentInput?.addEventListener("input", () => {
  const raw = String(saleCommentInput.value || "");
  const formatted = formatCommentPhone(raw).slice(0, 120);
  if (formatted !== raw && raw.replace(/[^\d]/g, "").length === 11) {
    saleCommentInput.value = formatted;
  }
  saveSaleDraft();
});
saleClientInput?.addEventListener("input", async () => {
  selectedSaleClientId = null;
  if (saleClientInput.value.trim()) {
    updateActiveSessionLabel(saleClientInput.value.trim());
  } else {
    updateActiveSessionLabel("");
  }
  syncActiveClientToSession();
  saveSaleDraft();
  try {
    await loadClients(saleClientInput.value);
    renderSaleClientResults();
  } catch (err) {
    showToast(err.message);
  }
});
saleClientInput?.addEventListener("focus", () => {
  if (saleClientInput.value) {
    saleClientInput.value = "";
    selectedSaleClientId = null;
    syncActiveClientToSession();
    saveSaleDraft();
  }
  renderSaleClientResults();
});
saleClientInput?.addEventListener("blur", () => {
  setTimeout(() => saleClientResults?.classList.add("hidden"), 120);
});
saleCommentInput?.addEventListener("blur", () => {
  saleCommentInput.value = formatCommentPhone(saleCommentInput.value).slice(0, 120);
  saveSaleDraft();
});
searchInput.addEventListener("focus", () => {
  if (searchInput.value) {
    searchInput.value = "";
    renderProducts();
  }
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    renderProducts();
  }
});
sellBtn.addEventListener("click", openCashModal);
cardBtn.addEventListener("click", sellByCard);
debtBtn?.addEventListener("click", async () => {
  const selectedClient = getSelectedClient();
  if (selectedClient) {
    await checkout("debt", { clientId: Number(selectedClient.id) });
    return;
  }
  openDebtModal("create");
});
printBtn.addEventListener("click", printLastReceipt);
resetBtn.addEventListener("click", resetCart);
newCartBtn?.addEventListener("click", createNewCartSession);
closeCartBtn?.addEventListener("click", closeCurrentCartSession);
modalCancelBtn.addEventListener("click", closeAddModal);
modalSaveBtn.addEventListener("click", submitAddModal);
bindSelectAllOnFocus(modalQtyInput);
bindSelectAllOnFocus(modalPriceInput);
addItemModal.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-modal")) {
    closeAddModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (addItemModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeAddModal();
  if (event.key === "Enter") submitAddModal();
});

cashReceivedInput.addEventListener("input", () => {
  cashReceivedInput.value = cashReceivedInput.value.replace(/[^\d.,]/g, "");
  renderCashModalValues();
});
cashCloseBtn.addEventListener("click", closeCashModal);
cashConfirmBtn.addEventListener("click", confirmCashSale);
cashExactBtn?.addEventListener("click", setExactCashReceived);
autoPrintToggle?.addEventListener("change", () => {
  setAutoPrintEnabled(Boolean(autoPrintToggle.checked));
});
cashModal.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-cash-modal")) {
    closeCashModal();
  }
});
debtCloseBtn?.addEventListener("click", closeDebtModal);
debtConfirmBtn?.addEventListener("click", confirmDebtSale);
debtClientSearchInput?.addEventListener("input", async () => {
  try {
    await loadClients(debtClientSearchInput.value);
    selectedDebtClientId = null;
    renderDebtClientResults();
  } catch (err) {
    showToast(err.message);
  }
});
debtClientSearchInput?.addEventListener("focus", () => {
  renderDebtClientResults();
});
debtClientSearchInput?.addEventListener("blur", () => {
  setTimeout(() => debtClientResults?.classList.add("hidden"), 120);
});
debtModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-debt-modal")) {
    closeDebtModal();
  }
});
document.querySelectorAll("[data-pad]").forEach((btn) => {
  btn.addEventListener("click", () => keypadInput(btn.dataset.pad));
});
document.addEventListener("keydown", (event) => {
  if (cashModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeCashModal();
  if (event.key === "Enter") confirmCashSale();
});
document.addEventListener("keydown", (event) => {
  if (debtModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeDebtModal();
  if (event.key === "Enter") confirmDebtSale();
});

document.addEventListener("keydown", (event) => {
  if (isAnyModalOpen()) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key.length !== 1) return;

  const active = document.activeElement;
  const tag = String(active?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || active?.isContentEditable) return;

  event.preventDefault();
  searchInput.focus();
  searchInput.value += event.key;
  renderProducts();
});

Promise.all([loadProducts(), loadReport(), loadClients()])
  .then(() => {
    const restored = restoreSaleDraft();
    if (!restored) loadActiveSessionToUI();
    renderCart();
    if (restored) {
      printBtn.disabled = false;
      showToast("Черновик чека восстановлен");
    }
    focusSearchInput(false);
  })
  .catch(() => showToast("Не удалось загрузить данные"));

if (autoPrintToggle) {
  autoPrintToggle.checked = isAutoPrintEnabled();
}
