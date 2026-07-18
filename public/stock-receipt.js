const productSearchInput = document.getElementById("productSearchInput");
const productSearchResults = document.getElementById("productSearchResults");
const productIdInput = document.getElementById("productIdInput");
const newProductBtn = document.getElementById("newProductBtn");
const newProductFields = document.getElementById("newProductFields");
const newProductNameInput = document.getElementById("newProductNameInput");
const newProductCategorySelect = document.getElementById("newProductCategorySelect");
const receiptQtyInput = document.getElementById("receiptQtyInput");
const receiptUnitSelect = document.getElementById("receiptUnitSelect");
const receiptCostPriceInput = document.getElementById("receiptCostPriceInput");
const receiptPriceInput = document.getElementById("receiptPriceInput");
const receiptMinPriceInput = document.getElementById("receiptMinPriceInput");
const addItemBtn = document.getElementById("addItemBtn");
const receiptCommentInput = document.getElementById("receiptCommentInput");

const receiptItemsList = document.getElementById("receiptItemsList");
const totalCostValue = document.getElementById("totalCostValue");
const totalRetailValue = document.getElementById("totalRetailValue");
const saveReceiptBtn = document.getElementById("saveReceiptBtn");
const printReceiptBtn = document.getElementById("printReceiptBtn");

const receiptSearchInput = document.getElementById("receiptSearchInput");
const refreshReceiptsBtn = document.getElementById("refreshReceiptsBtn");
const receiptsHistory = document.getElementById("receiptsHistory");

const viewReceiptModal = document.getElementById("viewReceiptModal");
const viewReceiptCode = document.getElementById("viewReceiptCode");
const viewReceiptContent = document.getElementById("viewReceiptContent");
const viewPrintBtn = document.getElementById("viewPrintBtn");
const viewDownloadBtn = document.getElementById("viewDownloadBtn");
const viewCloseBtn = document.getElementById("viewCloseBtn");

const toast = document.getElementById("toast");

const state = {
  products: [],
  categories: [],
  receiptItems: [],
  receipts: [],
  viewingReceipt: null,
  selectedProductId: null
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function formatMoney(value) {
  const amount = Math.round(Number(value || 0));
  return `${amount.toLocaleString("ru-RU")} т`;
}

function formatQty(value) {
  const num = Number(value || 0);
  if (Number.isInteger(num)) return String(num);
  return String(num).replace(/\.?0+$/, "");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[xх×*]/g, "*")
    .replace(/\s+/g, "");
}

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("Не удалось загрузить товары");
    state.products = await res.json();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadCategories() {
  try {
    const res = await fetch("/api/categories");
    if (!res.ok) throw new Error("Не удалось загрузить категории");
    state.categories = await res.json();
    renderCategoryOptions();
  } catch (err) {
    showToast(err.message);
  }
}

function renderCategoryOptions() {
  const options = state.categories.length 
    ? state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join("")
    : '<option value="Без категории">Без категории</option>';
  if (newProductCategorySelect) {
    newProductCategorySelect.innerHTML = options;
  }
}

function searchProducts(query) {
  const q = normalizeSearchText(query);
  if (!q) {
    productSearchResults.innerHTML = "";
    return;
  }
  
  const results = state.products.filter(p => 
    normalizeSearchText(p.name).includes(q) ||
    normalizeSearchText(p.sku).includes(q)
  ).slice(0, 20);

  if (results.length === 0) {
    productSearchResults.innerHTML = '<div class="search-no-results">Товары не найдены</div>';
    return;
  }

  productSearchResults.innerHTML = results.map(p => `
    <div class="search-result-item" data-product-id="${p.id}" data-product-name="${p.name}" data-product-unit="${p.unit}" data-product-price="${p.price}">
      <div class="search-result-name">${p.name}</div>
      <div class="search-result-meta">
        <span class="search-result-price">${formatMoney(p.price)}</span>
        <span class="search-result-unit">${p.unit || "шт"}</span>
        <span class="search-result-sku">${p.sku || ""}</span>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click", () => {
      selectProduct(
        item.dataset.productId,
        item.dataset.productName,
        item.dataset.productUnit,
        Number(item.dataset.productPrice)
      );
    });
  });
}

function selectProduct(id, name, unit, price) {
  state.selectedProductId = id;
  productIdInput.value = id;
  productSearchInput.value = name;
  productSearchResults.innerHTML = "";
  receiptPriceInput.value = price.toFixed(2);
  receiptPriceInput.removeAttribute("readonly");
  receiptUnitSelect.value = unit || "шт";
  receiptUnitSelect.setAttribute("disabled", true);
  newProductFields.classList.add("hidden");
  receiptQtyInput.focus();
}

newProductBtn.addEventListener("click", () => {
  const wasHidden = newProductFields.classList.contains("hidden");
  newProductFields.classList.toggle("hidden");
  
  if (wasHidden) {
    state.selectedProductId = null;
    productIdInput.value = "";
    productSearchInput.value = "";
    receiptPriceInput.value = "";
    receiptPriceInput.removeAttribute("readonly");
    receiptUnitSelect.removeAttribute("disabled");
    setTimeout(() => newProductNameInput.focus(), 50);
  }
});

function bindSelectAllOnFocus(input) {
  if (!input) return;
  input.addEventListener("focus", () => {
    setTimeout(() => {
      if (document.activeElement === input) {
        input.select();
      }
    }, 0);
  });
  input.addEventListener("click", () => {
    setTimeout(() => {
      if (document.activeElement === input) {
        input.select();
      }
    }, 0);
  });
  input.addEventListener("mouseup", (event) => {
    event.preventDefault();
    setTimeout(() => {
      if (document.activeElement === input) {
        input.select();
      }
    }, 0);
  });
}

[productSearchInput, receiptQtyInput, receiptCostPriceInput, receiptPriceInput].forEach(bindSelectAllOnFocus);

let searchTimeout;
productSearchInput.addEventListener("input", () => {
  state.selectedProductId = null;
  productIdInput.value = "";
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchProducts(productSearchInput.value), 200);
});

addItemBtn.addEventListener("click", () => {
  let productName;
  let productId = state.selectedProductId || productIdInput.value || null;
  
  if (productId) {
    const product = state.products.find(p => String(p.id) === String(productId));
    if (product) {
      productName = product.name;
    } else {
      productName = productSearchInput.value.trim();
    }
  } else {
    productName = newProductNameInput.value.trim();
  }
  
  const qty = Number(receiptQtyInput.value);
  const unit = receiptUnitSelect.value;
  let costPrice = Number(receiptCostPriceInput.value);
  const price = Number(receiptPriceInput.value);
  const minPrice = Number(receiptMinPriceInput.value) || price;
  
  if (!costPrice || costPrice <= 0) {
    costPrice = price;
  }

  if (!productName) {
    showToast("Введите название товара или выберите из списка");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    showToast("Введите корректное количество");
    return;
  }
  if (!Number.isFinite(costPrice) || costPrice <= 0) {
    showToast("Введите закупочную цену");
    return;
  }
  if (!Number.isFinite(price) || price <= 0) {
    showToast("Введите розничную цену");
    return;
  }

  const existingItem = state.receiptItems.find(item => item.name === productName && item.productId === productId);
  if (existingItem) {
    existingItem.qty = Number((existingItem.qty + qty).toFixed(3));
    existingItem.costPrice = costPrice;
    existingItem.price = price;
  } else {
    state.receiptItems.push({
      productId: productId || null,
      name: productName,
      qty,
      unit,
      costPrice,
      price,
      minPrice,
      isNew: !productId
    });
  }

  renderReceiptItems();
  resetItemForm();
});

function resetItemForm() {
  state.selectedProductId = null;
  productIdInput.value = "";
  productSearchInput.value = "";
  productSearchResults.innerHTML = "";
  newProductNameInput.value = "";
  receiptQtyInput.value = "1";
  receiptCostPriceInput.value = "";
  receiptPriceInput.value = "";
  receiptPriceInput.removeAttribute("readonly");
  receiptUnitSelect.value = "шт";
  receiptUnitSelect.removeAttribute("disabled");
  newProductFields.classList.add("hidden");
  productSearchInput.focus();
}

function renderReceiptItems() {
  if (state.receiptItems.length === 0) {
    receiptItemsList.innerHTML = '<p class="muted">Товары не добавлены</p>';
  } else {
    receiptItemsList.innerHTML = `
      <div class="receipt-items-header">
        <span>Товар</span>
        <span>Кол-во</span>
        <span>Ед.</span>
        <span>Закуп</span>
        <span>Мин. цена</span>
        <span>Сумма</span>
        <span></span>
      </div>
      ${state.receiptItems.map((item, index) => `
        <div class="receipt-item-row" data-item-index="${index}">
          <span class="ri-name">${item.name}</span>
          <span class="ri-qty">${formatQty(item.qty)}</span>
          <span class="ri-unit">${item.unit}</span>
          <span class="ri-cost">${formatMoney(item.costPrice)}</span>
          <span class="ri-price">${formatMoney(item.minPrice || item.price)}</span>
          <span class="ri-total">${formatMoney(item.qty * (item.minPrice || item.price))}</span>
          <button class="btn small danger" data-remove-item="${index}">✕</button>
        </div>
      `).join("")}
    `;

    document.querySelectorAll("[data-remove-item]").forEach(btn => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.removeItem);
        state.receiptItems.splice(index, 1);
        renderReceiptItems();
      });
    });
  }

  const totalCost = state.receiptItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const totalRetail = state.receiptItems.reduce((sum, item) => sum + item.qty * (item.minPrice || item.price), 0);
  totalCostValue.textContent = formatMoney(totalCost);
  totalRetailValue.textContent = formatMoney(totalRetail);
}

async function saveReceipt() {
  if (state.receiptItems.length === 0) {
    showToast("Добавьте товары в приход");
    return;
  }

  const payload = {
    cashier: "Кассир",
    comment: receiptCommentInput.value.trim(),
    items: state.receiptItems.map(item => ({
      productId: item.productId,
      name: item.name,
      qty: Number(item.qty.toFixed(3)),
      unit: item.unit,
      costPrice: Number(item.costPrice.toFixed(2)),
      price: Number(item.price.toFixed(2)),
      minPrice: item.minPrice ? Number(item.minPrice.toFixed(2)) : Number(item.price.toFixed(2)),
      isNew: item.isNew
    }))
  };

  try {
    const res = await fetch("/api/stock-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка сохранения прихода");
    showToast(`Приход сохранен: накл. №${data.code}`);
    state.receiptItems = [];
    renderReceiptItems();
    loadReceipts();
  } catch (err) {
    showToast(err.message);
  }
}

async function printReceipt(code) {
  try {
    const res = await fetch(`/api/stock-receipts/${code}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка печати");
    showToast("Приход отправлен на печать");
  } catch (err) {
    showToast(err.message);
  }
}

saveReceiptBtn.addEventListener("click", saveReceipt);

async function showPrintPreviewAndPrint() {
  if (state.receiptItems.length === 0) {
    showToast("Добавьте товары в приход");
    return;
  }

  const payload = {
    cashier: "Кассир",
    comment: receiptCommentInput.value.trim(),
    items: state.receiptItems.map(item => ({
      productId: item.productId,
      name: item.name,
      qty: Number(item.qty.toFixed(3)),
      unit: item.unit,
      costPrice: Number(item.costPrice.toFixed(2)),
      price: Number(item.price.toFixed(2)),
      minPrice: item.minPrice ? Number(item.minPrice.toFixed(2)) : Number(item.price.toFixed(2)),
      isNew: item.isNew
    }))
  };

const tempReceipt = {
    code: `TMP-${Date.now()}`,
    createdAt: new Date().toISOString(),
    cashier: payload.cashier,
    items: payload.items,
    totalCost: payload.items.reduce((sum, item) => sum + item.qty * item.costPrice, 0),
    totalRetail: payload.items.reduce((sum, item) => sum + item.qty * (item.minPrice || item.price), 0),
    comment: payload.comment
  };

  openStockReceiptPreview(tempReceipt);
}

printReceiptBtn.addEventListener("click", showPrintPreviewAndPrint);

async function loadReceipts() {
  try {
    const res = await fetch("/api/stock-receipts");
    if (!res.ok) throw new Error("Не удалось загрузить приходы");
    state.receipts = await res.json();
    renderReceiptsHistory();
  } catch (err) {
    showToast(err.message);
  }
}

function renderReceiptsHistory() {
  const q = receiptSearchInput.value.toLowerCase().trim();
  const filtered = state.receipts.filter(r => 
    r.code.toLowerCase().includes(q) || 
    (r.comment || "").toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    receiptsHistory.innerHTML = '<p class="muted">Приходы не найдены</p>';
    return;
  }

  receiptsHistory.innerHTML = `
    <div class="receipts-table">
      <div class="receipts-header">
        <span>Накладная</span>
        <span>Дата</span>
        <span>Комментарий</span>
        <span>Закуп</span>
        <span>Розн</span>
        <span></span>
      </div>
      ${filtered.map(r => `
        <div class="receipt-row" data-view-receipt="${r.code}">
          <span class="rc-code">№${r.code}</span>
          <span class="rc-date">${new Date(r.createdAt).toLocaleDateString("ru-RU")}</span>
          <span class="rc-comment">${r.comment || ""}</span>
          <span class="rc-cost">${formatMoney(r.totalCost)}</span>
          <span class="rc-retail">${formatMoney(r.totalRetail)}</span>
<span class="rc-actions">
            <button class="btn small" data-print-receipt="${r.code}">Печать</button>
            <button class="btn small danger" data-delete-receipt="${r.code}">Удалить</button>
          </span>
        </div>
      `).join("")}
    </div>
  `;

  document.querySelectorAll("[data-view-receipt]").forEach(row => {
    row.addEventListener("click", () => viewReceipt(row.dataset.viewReceipt));
  });
document.querySelectorAll("[data-print-receipt]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const code = btn.dataset.printReceipt;
      const res = await fetch(`/api/stock-receipts/${code}`);
      if (!res.ok) return;
      const receipt = await res.json();
      openStockReceiptPreview(receipt);
    });
  });
  document.querySelectorAll("[data-delete-receipt]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Удалить приход?")) {
        deleteReceipt(btn.dataset.deleteReceipt);
      }
    });
  });
}

async function deleteReceipt(code) {
  try {
    const res = await fetch(`/api/stock-receipts/${code}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка удаления прихода");
    showToast("Приход удален");
    loadReceipts();
  } catch (err) {
    showToast(err.message);
  }
}

async function viewReceipt(code) {
  try {
    const res = await fetch(`/api/stock-receipts/${code}`);
    if (!res.ok) throw new Error("Не удалось загрузить приход");
    const receipt = await res.json();
    openStockReceiptPreview(receipt);
  } catch (err) {
    showToast(err.message);
  }
}

async function openStockReceiptPreview(receipt) {
  const soldAt = new Date(receipt.createdAt || Date.now());
  const docDate = soldAt.toLocaleDateString("ru-RU");
  
const width = 900;
const height = 900;

const left = Math.max(0, (screen.availWidth - width) / 2);
const top = Math.max(0, (screen.availHeight - height) / 2);

const previewWindow = window.open(
  "",
  "_blank",
  `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
);
  if (!previewWindow) {
    showToast("Не удалось открыть окно предпросмотра");
    return;
  }
  
const itemsHtml = receipt.items.map(item => {
    const qtyStr = formatQty(item.qty);
    const costStr = formatMoney(item.costPrice);
    const priceStr = formatMoney(item.minPrice || item.price);
    const unitStr = item.unit || "шт";
    return `<div style="margin:4px 0;"><div>${item.name}</div><div style="display:flex;justify-content:space-between;font-size:11px;"><span>${qtyStr} ${unitStr}</span><span>= ${costStr} / ${priceStr}</span></div></div>`;
  }).join("");
  
  const totalCostStr = formatMoney(receipt.totalCost);
  const totalRetailStr = formatMoney(receipt.totalRetail);
  const codeStr = receipt.code || "-";
  
  const isTemp = codeStr.startsWith("TMP-");
  const printEndpoint = isTemp ? "/api/stock-receipts/print-only" : "/api/stock-receipts/" + codeStr + "/print";
  const printPayload = isTemp ? { 
    cashier: receipt.cashier, 
    items: receipt.items, 
    comment: receipt.comment 
  } : {};
  
const commentHtml = receipt.comment ? `<div style="margin:4px 0; font-size:11px;">${receipt.comment}</div>` : "";
  
  const previewHtml = `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <title>Приход ${codeStr}</title>
        <style>
          @page { size: 80mm auto; margin: 2mm; }
          :root { --preview-scale: 1.5; }
          html, body { width: 100%; }
          body{
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
          .receipt{width:76mm;margin:0 auto;padding:2mm;background:#fff;border:1px solid #d6e0ea;box-shadow:0 8px 24px rgba(18,32,48,0.12);transform:scale(var(--preview-scale));transform-origin:top center}
          .center{text-align:center}
          .bold{font-weight:700}
          .line{border-top:1px dotted #777;margin:6px 0}
          .toolbar{
            position:sticky;
            top:0;
            display:flex;
            gap:8px;
            justify-content:flex-end;
            align-items:center;
            background:#f2f5f8;
            padding:12px 22px 8px;
            border-bottom:1px solid #d7e0e9;
            z-index:2;
          }
          .toolbar button{
            border:1px solid #c9d8ea;
            border-radius:8px;
            padding:8px 12px;
            font-size:14px;
            cursor:pointer;
            background:#fff;
          }
          #zoomBtn { min-width: 92px; }
          .toolbar .primary{
            background:#0a76f6;
            color:#fff;
            border-color:#0a76f6;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button id="zoomBtn" title="Масштаб">150%</button>
          <button id="closeBtn">Закрыть</button>
          <button id="downloadBtn">Скачать чек (JPEG)</button>
          <button id="printBtn" class="primary">Отправить на принтер</button>
        </div>
        <div class="preview-wrap">
          <div class="receipt">
            <div class="center bold">МЕРОС</div>
            <div class="center">ПРИХОД ТОВАРА</div>
            <div class="line"></div>
            <div class="center bold">#${codeStr}</div>
            <div class="center">${docDate}</div>
            ${commentHtml}
            <div class="line"></div>
            ${itemsHtml}
            <div class="line"></div>
            <div style="margin-top:6px"><div>Закуп: ${totalCostStr}</div><div style="text-align:right">Приход: ${totalRetailStr}</div></div>
            <div class="line"></div>
            <div class="center bold">СПАСИБО!</div>
          </div>
        </div>
        <script src="/vendor/html2canvas.min.js"></script>
        <script>
          const sale = ${JSON.stringify({ code: receipt.code, createdAt: receipt.createdAt, items: receipt.items, totalCost: receipt.totalCost, totalRetail: receipt.totalRetail })};
          const isTemp = ${isTemp};
          const printEndpoint = "${printEndpoint}";
          const printPayload = ${JSON.stringify(printPayload)};
          const zoomBtn = document.getElementById("zoomBtn");
          const closeBtn = document.getElementById("closeBtn");
          const downloadBtn = document.getElementById("downloadBtn");
          const printBtn = document.getElementById("printBtn");
          const zoomLevels = [1.25, 1.5, 1.75];
          let zoomIndex = 2;
          const applyZoom = () => {
            const level = zoomLevels[zoomIndex];
            document.documentElement.style.setProperty("--preview-scale", String(level));
            zoomBtn.textContent = Math.round(level * 100) + "%";
          };
          applyZoom();
          zoomBtn.addEventListener("click", () => {
            zoomIndex = (zoomIndex + 1) % zoomLevels.length;
            applyZoom();
          });
          closeBtn.addEventListener("click", () => window.close());
downloadBtn.addEventListener("click", async () => {
            if (typeof html2canvas !== "function") return;
            const receiptEl = document.querySelector(".receipt");
            const prevWidth = receiptEl.style.width;
            const prevHeight = receiptEl.style.height;
            const prevScale = document.documentElement.style.getPropertyValue("--preview-scale");
            // Reset scale to 1 before screenshot
            document.documentElement.style.setProperty("--preview-scale", "1");
            // Wait for reflow
            await new Promise(r => setTimeout(r, 50));
            receiptEl.style.width = receiptEl.scrollWidth + "px";
            receiptEl.style.height = receiptEl.scrollHeight + "px";
            const canvas = await html2canvas(receiptEl, {
              scale: 2,
              backgroundColor: "#fff",
              width: receiptEl.scrollWidth,
              height: receiptEl.scrollHeight
            });
            receiptEl.style.width = prevWidth;
            receiptEl.style.height = prevHeight;
            document.documentElement.style.setProperty("--preview-scale", prevScale);
            const link = document.createElement("a");
            link.download = "Приход-" + sale.code + ".jpeg";
            link.href = canvas.toDataURL("image/jpeg", 0.95);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          });
printBtn.addEventListener("click", async () => {
            try {
              const res = await fetch(printEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: isTemp ? JSON.stringify(printPayload) : "{}"
              });
              if (res.ok) {
                setTimeout(() => window.close(), 500);
              } else {
                const data = await res.json().catch(() => ({}));
                console.error("Print error:", data);
              }
            } catch (e) {
              console.error("Print error:", e);
            }
          });
        </script>
      </body>
    </html>
  `;
  
  previewWindow.document.write(previewHtml);
  previewWindow.document.close();
}

function downloadReceipt() {
  if (!state.viewingReceipt) return;
  openStockReceiptPreview(state.viewingReceipt);
}

viewPrintBtn.addEventListener("click", () => {
  if (state.viewingReceipt) {
    printReceipt(state.viewingReceipt.code);
  }
});

viewDownloadBtn.addEventListener("click", downloadReceipt);

viewCloseBtn.addEventListener("click", () => {
  viewReceiptModal.classList.add("hidden");
  state.viewingReceipt = null;
});

viewReceiptModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-view-modal")) {
    viewReceiptModal.classList.add("hidden");
    state.viewingReceipt = null;
  }
});

receiptSearchInput.addEventListener("input", renderReceiptsHistory);
refreshReceiptsBtn.addEventListener("click", loadReceipts);

function checkElements() {
  const required = { productSearchInput, receiptQtyInput, receiptCostPriceInput, receiptPriceInput, addItemBtn };
  const missing = Object.entries(required).filter(([name, el]) => !el).map(([name]) => name);
  if (missing.length) {
    console.error("Missing elements:", missing.join(", "));
    showToast("Ошибка: не найдены элементы: " + missing.join(", "));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  checkElements();
  productSearchInput.focus();
});
Promise.all([loadProducts(), loadCategories(), loadReceipts()]).catch(e => {
  console.error("Init error:", e);
  showToast(e.message);
});