const debtorsSearchInput = document.getElementById("debtorsSearchInput");
const showAllClientsToggle = document.getElementById("showAllClientsToggle");
const createClientForm = document.getElementById("createClientForm");
const createClientNameInput = document.getElementById("createClientNameInput");
const createClientPhoneInput = document.getElementById("createClientPhoneInput");
const debtorsClientsList = document.getElementById("debtorsClientsList");
const debtorsSummaryBox = document.getElementById("debtorsSummaryBox");
const debtSaleSelect = document.getElementById("debtSaleSelect");
const debtAmountInput = document.getElementById("debtAmountInput");
const debtPaymentTypeSelect = document.getElementById("debtPaymentTypeSelect");
const debtPaymentCommentInput = document.getElementById("debtPaymentCommentInput");
const debtPaymentForm = document.getElementById("debtPaymentForm");
const debtSalesList = document.getElementById("debtSalesList");
const debtPaymentsList = document.getElementById("debtPaymentsList");
const previewAllDebtSalesBtn = document.getElementById("previewAllDebtSalesBtn");
const clearClientDebtsBtn = document.getElementById("clearClientDebtsBtn");
const fullDeleteClientBtn = document.getElementById("fullDeleteClientBtn");
const resyncClientBtn = document.getElementById("resyncClientBtn");
const importRemoteDebtsBtn = document.getElementById("importRemoteDebtsBtn");
const syncDebtsBtn = document.getElementById("syncDebtsBtn");
const toast = document.getElementById("toast");

const state = {
  clients: [],
  selectedClientId: null,
  selectedClientDebt: null
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

async function triggerDebtSyncRetry({ notify = false } = {}) {
  try {
    const reconcileRes = await fetch("/api/debts/sync/reconcile", { method: "POST" });
    const reconcileData = await reconcileRes.json().catch(() => ({}));
    if (!reconcileRes.ok) {
      throw new Error(reconcileData.error || "Ошибка сверки синхронизации");
    }
    const res = await fetch("/api/debts/sync/outbox/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Ошибка синхронизации");
    }
    if (notify) {
      const enqueued =
        reconcileData && !reconcileData.skipped
          ? `, добавлено: ${reconcileData.enqueuedSales + reconcileData.enqueuedPayments}`
          : "";
      showToast(
        `Синхронизация завершена${enqueued}. В очереди: ${data.pending}, ошибок: ${data.failed}`
      );
    }
  } catch (err) {
    if (notify) {
      showToast(err.message || "Ошибка синхронизации");
    }
  }
}

function restoreMainFocus() {
  setTimeout(() => {
    try {
      window.focus();
    } catch (_) {
      // no-op
    }
    if (debtorsSearchInput) debtorsSearchInput.focus();
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
      restoreMainFocus();
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

function paymentLabel(type) {
  if (type === "debt") return "В долг";
  return type === "card" ? "Карта" : "Наличные";
}

function formatQtyUnit(qty, unit) {
  const num = Number(qty || 0);
  const qtyText = Number.isInteger(num) ? String(num) : String(num).replace(/\.?0+$/, "");
  return `${qtyText} ${unit || "шт"}`;
}

function formatQtyValue(qty) {
  const num = Number(qty || 0);
  return String(Math.round(num));
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadClients() {
  const params = new URLSearchParams();
  params.set("onlyWithDebt", showAllClientsToggle.checked ? "0" : "1");

  const res = await fetch(`/api/debts/clients?${params.toString()}`);
  if (!res.ok) throw new Error("Не удалось загрузить клиентов");
  const list = await res.json();
  
  // Always read search value from input field
  const q = normalizeSearchText(debtorsSearchInput.value);
  state.clients = q
    ? list.filter((client) => {
        const name = normalizeSearchText(client.name);
        const phone = normalizeSearchText(client.phone);
        return name.includes(q) || phone.includes(q);
      })
    : list;
  renderClients();
}

function renderClients() {
  if (!state.clients.length) {
    debtorsClientsList.innerHTML = "<p class=\"muted\">Клиенты не найдены</p>";
    return;
  }

  debtorsClientsList.innerHTML = state.clients
    .map((client) => {
      const active = state.selectedClientId === client.id ? "is-active" : "";
      return `
        <button class="debt-client-row ${active}" data-client-id="${client.id}">
          <span class="debt-client-name">${escapeHtml(client.name)}</span>
          <span class="debt-client-phone">${escapeHtml(client.phone || "-")}</span>
          <strong class="debt-client-balance">${formatMoney(client.balance)}</strong>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-client-id]").forEach((btn) => {
    btn.addEventListener("click", () =>
      selectClient(Number(btn.dataset.clientId)).catch((e) => showToast(e.message))
    );
  });
}

async function selectClient(clientId) {
  state.selectedClientId = clientId;
  renderClients();

  const res = await fetch(`/api/clients/${clientId}/debt`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось загрузить данные клиента");
  }
  state.selectedClientDebt = await res.json();
  renderClientDebt();
}

function renderClientDebt() {
  const data = state.selectedClientDebt;
  if (!data) {
    debtorsSummaryBox.innerHTML = "<p class=\"muted\">Выберите клиента</p>";
    debtSalesList.innerHTML = "";
    debtPaymentsList.innerHTML = "";
    if (debtSaleSelect) {
      debtSaleSelect.innerHTML = "<option value=\"\">Все долги клиента</option>";
    }
    return;
  }

  const salesSorted = [...(data.sales || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const openDebtSales = salesSorted.filter((sale) => {
    const remaining = Math.max(0, Number(sale.debtTotal || 0) - Number(sale.debtPaidTotal || 0));
    return remaining > 0;
  });

  const client = data.client;
  debtorsSummaryBox.innerHTML = `
    <div><strong>${escapeHtml(client.name)}</strong>${client.phone ? ` (${escapeHtml(client.phone)})` : ""}</div>
    <div>Продано в долг: <strong>${formatMoney(data.debtSold)}</strong></div>
    <div>Погашено: <strong>${formatMoney(data.debtPaid)}</strong></div>
    <div>Остаток долга: <strong>${formatMoney(data.balance)}</strong></div>
    <div>Оборот клиента: <strong>${formatMoney(data.totalAmount)}</strong></div>
    <div>Товаров (кол-во): <strong>${formatQtyValue(data.itemsQty)}</strong></div>
    <div>Товаров (сумма): <strong>${formatMoney(data.itemsAmount)}</strong></div>
    <div>Наличные: <strong>${formatMoney(data.byPayment?.cash || 0)}</strong></div>
    <div>Перевод: <strong>${formatMoney(data.byPayment?.card || 0)}</strong></div>
    <div>В долг: <strong>${formatMoney(data.byPayment?.debt || 0)}</strong></div>
  `;

  if (debtSaleSelect) {
    debtSaleSelect.innerHTML = `
      <option value="">Все долги клиента</option>
      ${openDebtSales
        .map((sale) => {
          const label = sale.isReturn ? "ВОЗВРАТ" : "";
          const remaining = Math.max(
            0,
            Number(sale.debtTotal || 0) - Number(sale.debtPaidTotal || 0)
          );
          return `<option value="${sale.dbId}" data-remaining="${remaining}">${escapeHtml(sale.id)} • ${new Date(
            sale.createdAt
          ).toLocaleDateString()} • ${formatMoney(sale.debtTotal)} ${label}</option>`;
        })
        .join("")}
    `;
  }

  if (!openDebtSales.length) {
    debtSalesList.innerHTML = "<p class=\"muted\">Чеков в долг нет</p>";
  } else {
    debtSalesList.innerHTML = openDebtSales
      .map(
        (sale) => {
          const paid = Number(sale.debtPaidTotal || 0);
          const total = Number(sale.debtTotal || 0);
          const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
          const bgStyle =
            sale.debtStatus === "paid"
              ? "background: #e9f7ee;"
              : sale.debtStatus === "partial"
                ? `background: linear-gradient(90deg, #e9f7ee ${percent}%, #fff ${percent}%);`
                : "";
          const statusLabel =
            sale.debtStatus === "paid"
              ? `<div class="payment-badge cash">Погашен</div>`
              : sale.debtStatus === "partial"
                ? `<div class="payment-badge debt">Погашен ${percent}%</div>`
                : "";
          return `
          <article class="journal-item" style="${bgStyle}">
            <div class="journal-head">
              <strong>${escapeHtml(sale.id)}</strong>
              <span>${new Date(sale.createdAt).toLocaleString()}</span>
              ${sale.isReturn ? `<span class="muted">ВОЗВРАТ</span>` : ""}
              <strong>${formatMoney(sale.debtTotal)}</strong>
            </div>
            ${statusLabel}
            <div class="journal-actions">
              <button class="btn" data-preview-sale="${escapeHtml(sale.id)}">Предпросмотр</button>
              ${sale.isReturn ? "" : `<button class="btn" data-return-sale="${escapeHtml(sale.id)}">Возврат</button>`}
              <button class="btn" data-close-debt-sale="${escapeHtml(sale.id)}">Погасить долг</button>
            </div>
            ${sale.comment ? `<div class="muted">${escapeHtml(sale.comment)}</div>` : ""}
          </article>
        `;
        }
      )
      .join("");

    document.querySelectorAll("[data-preview-sale]").forEach((btn) => {
      btn.addEventListener("click", () =>
        previewSaleByCode(String(btn.dataset.previewSale || "")).catch((e) => showToast(e.message))
      );
    });
    document.querySelectorAll("[data-return-sale]").forEach((btn) => {
      btn.addEventListener("click", () =>
        returnDebtSale(String(btn.dataset.returnSale || "")).catch((e) => showToast(e.message))
      );
    });
    document.querySelectorAll("[data-close-debt-sale]").forEach((btn) => {
      btn.addEventListener("click", () =>
        closeDebtSale(String(btn.dataset.closeDebtSale || "")).catch((e) => showToast(e.message))
      );
    });
  }

  if (!data.payments.length) {
    debtPaymentsList.innerHTML = "<p class=\"muted\">Погашений пока нет</p>";
  } else {
    debtPaymentsList.innerHTML = data.payments
      .map(
        (payment) => `
          <article class="journal-item">
            <div class="journal-head">
              <strong>#${payment.id}</strong>
              <span>${new Date(payment.createdAt).toLocaleString()}</span>
              <span>${paymentLabel(payment.paymentType)}</span>
              <strong>${formatMoney(payment.amount)}</strong>
            </div>
            ${payment.saleId ? `<div class="muted">Чек: ${payment.saleId}</div>` : ""}
            ${payment.comment ? `<div class="muted">${escapeHtml(payment.comment)}</div>` : ""}
            <div class="journal-actions">
              <button class="btn danger" data-delete-payment="${payment.id}">Удалить оплату</button>
            </div>
          </article>
        `
      )
      .join("");

    document.querySelectorAll("[data-delete-payment]").forEach((btn) => {
      btn.addEventListener("click", () =>
        deleteDebtPayment(Number(btn.dataset.deletePayment || 0)).catch((e) => showToast(e.message))
      );
    });
  }
}

debtSaleSelect?.addEventListener("change", () => {
  const selectedId = Number(debtSaleSelect.value || 0);
  if (!selectedId) return;
  const data = state.selectedClientDebt;
  if (!data || !Array.isArray(data.sales)) return;
  const sale = data.sales.find((s) => Number(s.dbId) === selectedId);
  if (!sale) return;
  const remaining = Math.max(0, Number(sale.debtTotal || 0) - Number(sale.debtPaidTotal || 0));
  debtAmountInput.value = remaining > 0 ? remaining.toFixed(2) : "";
});

async function loadSaleByCode(saleCode) {
  const res = await fetch(`/api/sales/${encodeURIComponent(saleCode)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось загрузить чек");
  return data;
}

function requestAdminPin(message) {
  return requestTextInput(message, "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
}

function requestReturnItems(sale) {
  return new Promise((resolve) => {
    const items = Array.isArray(sale?.items) ? sale.items : [];
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(10, 20, 35, 0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "10000";

    const card = document.createElement("div");
    card.style.width = "min(620px, 94vw)";
    card.style.maxHeight = "80vh";
    card.style.overflow = "auto";
    card.style.background = "#fff";
    card.style.border = "1px solid #d7e2ee";
    card.style.borderRadius = "12px";
    card.style.padding = "16px";
    card.style.boxShadow = "0 14px 32px rgba(16, 28, 42, 0.25)";

    const title = document.createElement("h3");
    title.textContent = `Возврат по чеку ${sale.id || ""}`;
    title.style.margin = "0 0 10px";
    title.style.fontSize = "20px";

    const hint = document.createElement("div");
    hint.textContent = "Укажите количество для возврата по каждой позиции.";
    hint.style.color = "#4d6075";
    hint.style.marginBottom = "10px";

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "8px";

    const inputs = [];
    items.forEach((item) => {
      const row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "1fr 120px 90px";
      row.style.gap = "8px";
      row.style.alignItems = "center";

      const name = document.createElement("div");
      name.textContent = item.name || "";

      const maxQty = Math.abs(Number(item.qty || 0));
      const maxLabel = document.createElement("div");
      maxLabel.textContent = `Макс: ${maxQty}`;
      maxLabel.style.color = "#6b7a90";

      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.001";
      input.min = "0";
      input.max = String(maxQty);
      input.value = "0";
      input.style.width = "100%";
      input.style.padding = "8px 10px";
      input.style.border = "1px solid #c9d8ea";
      input.style.borderRadius = "8px";

      input.addEventListener("input", () => {
        let v = Number(input.value || 0);
        if (Number.isNaN(v) || v < 0) v = 0;
        if (v > maxQty) v = maxQty;
        input.value = String(v);
        updateOkState();
      });

      row.appendChild(name);
      row.appendChild(maxLabel);
      row.appendChild(input);
      list.appendChild(row);

      inputs.push({ item, input, maxQty });
    });

    const error = document.createElement("div");
    error.style.color = "#b42318";
    error.style.marginTop = "8px";
    error.style.display = "none";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "14px";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Отмена";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn primary";
    okBtn.textContent = "Оформить возврат";

    const cleanup = () => {
      overlay.remove();
    };
    const updateOkState = () => {
      const any = inputs.some((it) => Number(it.input.value || 0) > 0);
      okBtn.disabled = !any;
    };

    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });
    okBtn.addEventListener("click", () => {
      const selected = inputs
        .map((it) => ({ itemId: it.item.itemId, qty: Number(it.input.value || 0) }))
        .filter((it) => Number(it.qty) > 0);
      if (!selected.length) {
        error.textContent = "Выберите количество для возврата.";
        error.style.display = "block";
        return;
      }
      cleanup();
      resolve(selected);
    });

    updateOkState();

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(list);
    card.appendChild(error);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

async function returnDebtSale(saleCode) {
  const fullSale = await loadSaleByCode(saleCode);
  if (fullSale.isReturn) {
    showToast("Возврат по этому чеку делать нельзя");
    return;
  }

  const returnItems = await requestReturnItems(fullSale);
  if (!returnItems) return;

  const adminPin = await requestAdminPin("Введите PIN администратора для возврата:");
  if (adminPin === null) return;

  const resp = await fetch(`/api/sales/${encodeURIComponent(fullSale.id)}/return`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim(), items: returnItems })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    showToast(data.error || "Ошибка возврата");
    return;
  }
  showToast(`Возврат создан: ${data.id}`);
  await loadClients();
  if (state.selectedClientId) {
    await selectClient(state.selectedClientId);
  }
  restoreMainFocus();
}

async function closeDebtSale(saleCode) {
  const data = state.selectedClientDebt;
  if (!data?.client?.id) {
    showToast("Сначала выберите должника");
    return;
  }
  const sale = data.sales?.find((s) => String(s.id) === String(saleCode));
  if (!sale) {
    showToast("Чек не найден");
    return;
  }
  const remaining = Math.max(0, Number(sale.debtTotal || 0) - Number(sale.debtPaidTotal || 0));
  if (remaining <= 0) {
    showToast("Долг уже погашен");
    return;
  }
  const ok = await requestConfirm(`Погасить долг по чеку ${sale.id} на ${formatMoney(remaining)}?`, {
    title: "Погашение долга",
    yesText: "Погасить",
    noText: "Отмена"
  });
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch("/api/debts/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: Number(data.client.id),
      saleId: Number(sale.dbId),
      amount: remaining,
      paymentType: "cash",
      comment: `Погашение чека ${sale.id}`,
      adminPin: String(adminPin).trim()
    })
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка погашения долга");
  }

  showToast(`Чек ${sale.id} погашен`);
  await loadClients();
  await selectClient(data.client.id);
  restoreMainFocus();
}
async function deleteDebtPayment(paymentId) {
  if (!paymentId) return;
  const ok = await requestConfirm(`Удалить оплату #${paymentId}?`, {
    title: "Удаление оплаты",
    yesText: "Удалить",
    noText: "Отмена"
  });
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch(`/api/debts/payments/${paymentId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Ошибка удаления оплаты");
  }

  showToast(`Оплата #${paymentId} удалена`);
  await loadClients();
  if (state.selectedClientId) {
    await selectClient(state.selectedClientId);
  }
  restoreMainFocus();
}

function renderReceiptHtmlBlock(sale) {
  const soldAt = new Date(sale.createdAt);
  const docDate = soldAt.toLocaleDateString();
  const docTime = soldAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const formatPrintAmount = (value) =>
    String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    const rows = (sale.items || [])
      .map((item, idx) => {
        const qtyValue = sale.isReturn ? Math.abs(Number(item.qty || 0)) : Number(item.qty || 0);
        const lineTotal = qtyValue * Number(item.price || 0);
        return `
          <tr>
            <td class="name">${idx + 1}. ${escapeHtml(item.name)}</td>
            <td class="qty">${escapeHtml(formatQtyUnit(qtyValue, item.unit))}</td>
            <td class="price">x ${formatPrintAmount(item.price)}</td>
            <td class="sum">= ${formatPrintAmount(lineTotal)}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="receipt">
      <div class="center">Добро пожаловать</div>
      <div class="center bold">Мерос</div>
      <div class="center muted">Телефон: +7 (702) 913-13-39</div>
        <div class="line"></div>
        <div class="center bold">ЧЕК НА ПРОДАЖУ № ${escapeHtml(sale.id)}</div>
        <div class="center">от ${docDate} ${docTime}</div>
        ${sale.isReturn ? `<div class="center bold">ВОЗВРАТ</div>` : ""}
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
        <tbody>${rows}</tbody>
      </table>

      <div class="line"></div>
      <div>Всего наименований: ${(sale.items || []).length}</div>
      <div class="totals">
        <div class="totals-row">
          <span>ИТОГО:</span>
          <span>${formatPrintAmount(sale.total)} тенге</span>
        </div>
      </div>
      <div class="line"></div>
      <div>Кассир: ${escapeHtml(sale.cashier || "-")}</div>
      <div>Оплата: ${paymentLabel(sale.paymentType)}</div>
      ${
        sale.paymentType === "debt" && sale.clientName
          ? `<div>Клиент: ${escapeHtml(sale.clientName)}${sale.clientPhone ? `, ${escapeHtml(sale.clientPhone)}` : ""}</div>`
          : ""
      }
      ${sale.comment ? `<div class="center bold">${escapeHtml(sale.comment)}</div>` : ""}
      <div class="line"></div>
      <div class="center bold">СПАСИБО ЗА ПОКУПКУ!</div>
    </div>
  `;
}

function openReceiptPreviewWindow(sales, summary = null) {
  const list = Array.isArray(sales) ? sales : [sales];
  const salesJson = JSON.stringify(list).replace(/</g, "\\u003c");
  const content = list
    .map((sale) => renderReceiptHtmlBlock(sale))
    .join('<div style="height:16px"></div>');
  const summaryTopHtml = summary
    ? `
      <div class="receipt debt-summary">
        <div><strong>Должник: ${escapeHtml(summary.clientName || "-")}</strong></div>
        <div>Остаток долга: <strong>${formatMoney(summary.balance || 0)}</strong></div>
      </div>
      <div style="height:12px"></div>
    `
    : "";

  const summaryBottomHtml = summary
    ? `
      <div style="height:12px"></div>
      <div class="receipt debt-summary">
        <div><strong>Должник: ${escapeHtml(summary.clientName || "-")}</strong></div>
        <div>Продано в долг: <strong>${formatMoney(summary.debtSold || 0)}</strong></div>
        <div>Погашено: <strong>${formatMoney(summary.debtPaid || 0)}</strong></div>
        <div>Остаток долга: <strong>${formatMoney(summary.balance || 0)}</strong></div>
      </div>
    `
    : "";

  const html = `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <title>Предпросмотр чека</title>
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
            .receipt-export {
              padding: 14px;
              background: #f2f5f8;
              display: inline-block;
            }
            .receipt-col {
              width: 76mm;
              transform: scale(var(--preview-scale));
              transform-origin: top center;
            }
          .receipt {
            width: 76mm;
            margin: 0 auto;
            padding: 2mm;
            background: #fff;
            border: 1px solid #d6e0ea;
            box-shadow: 0 8px 24px rgba(18, 32, 48, 0.12);
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
            <button id="whatsappBtn">WhatsApp</button>
            <button id="saveJpegBtn">Скачать чек (JPEG)</button>
            <button id="closeBtn">Закрыть</button>
            <button id="printAllBtn" class="primary">Отправить на принтер</button>
          </div>
          <div class="preview-wrap">
            <div class="receipt-export">
              <div class="receipt-col">${summaryTopHtml}${content}${summaryBottomHtml}</div>
            </div>
          </div>
          <script src="/vendor/html2canvas.min.js"></script>
          <script>
            const sales = ${salesJson};
            const clientName = ${JSON.stringify(summary?.clientName || "Чек")};
            const clientPhone = ${JSON.stringify(summary?.clientPhone || "")};
            const closeBtn = document.getElementById("closeBtn");
            const printAllBtn = document.getElementById("printAllBtn");
            const zoomBtn = document.getElementById("zoomBtn");
            const saveJpegBtn = document.getElementById("saveJpegBtn");
            const whatsappBtn = document.getElementById("whatsappBtn");
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
                normalizePhone(clientPhone) || extractPhoneFromText(sales?.[0]?.comment);
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
                await new Promise((r) => requestAnimationFrame(r));

                const receiptExport = document.querySelector(".receipt-export");
                const receiptCol = receiptExport?.querySelector(".receipt-col");

              if (!receiptExport || !receiptCol) {
              throw new Error("Не найден блок чека");
              }

              const prevTransform = receiptCol.style.transform;
              const prevOrigin = receiptCol.style.transformOrigin;

              receiptCol.style.transform = "none";
              receiptCol.style.transformOrigin = "top left";

              const rect = receiptCol.getBoundingClientRect();

              receiptExport.style.width = Math.ceil(rect.width) + "px";
              receiptExport.style.height = Math.ceil(rect.height) + "px";
                const canvas = await html2canvas(receiptExport, {
                  scale: 2,
                  backgroundColor: "#ffffff",
                });
                receiptCol.style.transform = prevTransform;
                receiptCol.style.transformOrigin = prevOrigin;
                const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
                const pad2 = (v) => String(v).padStart(2, "0");
                const stamp = new Date();
                const datePart =
                  stamp.getFullYear() + "-" + pad2(stamp.getMonth() + 1) + "-" + pad2(stamp.getDate());
                const timePart = pad2(stamp.getHours()) + "-" + pad2(stamp.getMinutes()) + "-" + pad2(stamp.getSeconds());
                const fileName = (clientName || "Чек") + " " + datePart + " " + timePart;
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
            printAllBtn.addEventListener("click", async () => {
              printAllBtn.disabled = true;
              try {
                for (const sale of sales) {
                const res = await fetch("/api/print/receipt", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sale })
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  throw new Error(data.error || "Ошибка отправки на принтер");
                }
              }
              alert("Чеки отправлены на принтер");
            } catch (err) {
              alert(err.message || "Ошибка печати");
            } finally {
              printAllBtn.disabled = false;
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
  const w = window.open("", "debtReceiptsPreview", features);
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

async function previewSaleByCode(saleCode) {
  const sale = await loadSaleByCode(saleCode);
  const s = state.selectedClientDebt;
  const summary = s
    ? {
        clientName: s.client?.name,
        clientPhone: s.client?.phone,
        debtSold: s.debtSold,
        debtPaid: s.debtPaid,
        balance: s.balance
      }
    : null;
  openReceiptPreviewWindow(sale, summary);
}

async function previewAllDebtSales() {
  const data = state.selectedClientDebt;
  if (!data?.sales?.length) {
    showToast("Нет чеков в долг для предпросмотра");
    return;
  }
  const salesSorted = [...data.sales].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const fullSales = await Promise.all(salesSorted.map((s) => loadSaleByCode(s.id)));
  openReceiptPreviewWindow(fullSales, {
    clientName: data.client?.name,
    clientPhone: data.client?.phone,
    debtSold: data.debtSold,
    debtPaid: data.debtPaid,
    balance: data.balance
  });
}

async function deleteDebtSale(saleCode) {
  const data = state.selectedClientDebt;
  if (!saleCode || !data?.client?.id) {
    showToast("Чек не найден");
    return;
  }
  const ok = await requestConfirm(`Удалить долговой чек ${saleCode}?`, {
    title: "Удаление чека",
    yesText: "Удалить",
    noText: "Отмена"
  });
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch(`/api/sales/${encodeURIComponent(saleCode)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim() })
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка удаления чека");
  }

  showToast(`Чек ${saleCode} удален`);
  await loadClients();
  await selectClient(data.client.id);
  restoreMainFocus();
}

async function clearClientDebts() {
  const data = state.selectedClientDebt;
  if (!data?.client?.id) {
    showToast("Сначала выберите должника");
    return;
  }
  const ok = await requestConfirm(`Удалить ВСЕ долги клиента ${data.client.name}?`, {
    title: "Удаление всех долгов",
    yesText: "Удалить",
    noText: "Отмена"
  });
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch(`/api/clients/${data.client.id}/debts`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim() })
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка удаления долгов");
  }

  showToast("Все долги клиента удалены");
  await loadClients();
  await selectClient(data.client.id);
  restoreMainFocus();
}

async function fullDeleteClientOperations() {
  const data = state.selectedClientDebt;
  if (!data?.client?.id) {
    showToast("Сначала выберите должника");
    return;
  }
  
  const ok = await requestConfirm(
    `⚠️ ПОЛНАЯ ОЧИСТКА: удалить ВСЕ операции и счета клиента ${data.client.name}?\n\nЭто необратимо!`,
    {
      title: "Полная очистка клиента",
      yesText: "Удалить полностью",
      noText: "Отмена"
    }
  );
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch(`/api/clients/${data.client.id}/full-delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim() })
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка полного удаления операций");
  }

  showToast(`✅ Клиент полностью очищен! Удалено: платежей=${result.payments}, счетов=${result.sales}`);
  await loadClients();
  await selectClient(data.client.id);
  restoreMainFocus();
}

async function resyncClient() {
  const data = state.selectedClientDebt;
  if (!data?.client?.id) {
    showToast("Сначала выберите должника");
    return;
  }
  const ok = await requestConfirm(
    `Пересоздать клиента ${data.client.name} в debt-tracker и отправить все операции заново?`,
    { title: "Пересоздание в debt-tracker", yesText: "Пересоздать", noText: "Отмена" }
  );
  if (!ok) return;

  const adminPin = await requestTextInput("Введите PIN администратора:", "", {
    title: "PIN администратора",
    inputMode: "numeric",
    password: true,
    placeholder: "PIN"
  });
  if (adminPin === null) return;

  const res = await fetch(`/api/debts/clients/${data.client.id}/resync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminPin: String(adminPin).trim() })
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка пересоздания");
  }

  showToast(
    `Пересоздано. В очередь: ${result.enqueuedSales || 0} долги, ${result.enqueuedPayments || 0} оплаты`
  );
  await loadClients();
  await selectClient(data.client.id);
  restoreMainFocus();
}

async function importRemoteDebts() {
  const importRecords = await requestConfirm(
    "Импортировать также историю долгов и погашений?\nДа = с записями, Нет = только карточки клиентов.",
    { title: "Импорт из debt-tracker", yesText: "Да", noText: "Нет" }
  );
  const res = await fetch("/api/debts/sync/import-remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ importRecords: importRecords ? 1 : 0 })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Ошибка импорта из debt-tracker");
  }

  showToast(
    `Импорт: клиентов +${data.clientsCreated || 0}, обновлено ${data.clientsUpdated || 0}, записей ${data.recordsImported || 0}`
  );
  
  // Clear search field after import
  debtorsSearchInput.value = "";
  
  await loadClients();
  if (state.selectedClientId) {
    await selectClient(state.selectedClientId);
  } else if (state.clients.length) {
    await selectClient(state.clients[0].id);
  } else {
    renderClientDebt();
  }
  restoreMainFocus();
}

async function createClient(event) {
  event.preventDefault();
  const name = String(createClientNameInput.value || "").trim();
  const phone = String(createClientPhoneInput.value || "").trim();
  if (!name) {
    showToast("Введите имя клиента");
    return;
  }

  const res = await fetch("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Ошибка создания клиента");
  }

  createClientForm.reset();
  showToast("Клиент создан");
  await loadClients();
}

async function payDebt(event) {
  event.preventDefault();
  const data = state.selectedClientDebt;
  if (!data?.client?.id) {
    showToast("Сначала выберите клиента");
    return;
  }

  const amount = Number(debtAmountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Введите сумму погашения");
    return;
  }

  const payload = {
    clientId: data.client.id,
    amount,
    saleId: debtSaleSelect?.value || null,
    paymentType: debtPaymentTypeSelect.value || "cash",
    comment: String(debtPaymentCommentInput.value || "").trim()
  };

  const res = await fetch("/api/debts/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || "Ошибка погашения долга");
  }

  debtPaymentForm.reset();
  debtPaymentTypeSelect.value = "cash";
  showToast("Погашение сохранено");
  await loadClients();
  await selectClient(data.client.id);
}

debtorsSearchInput.addEventListener("input", () =>
  loadClients().catch((e) => showToast(e.message))
);
showAllClientsToggle.addEventListener("change", () =>
  loadClients().catch((e) => showToast(e.message))
);
createClientForm.addEventListener("submit", (event) =>
  createClient(event).catch((e) => showToast(e.message))
);
debtPaymentForm.addEventListener("submit", (event) =>
  payDebt(event).catch((e) => showToast(e.message))
);
previewAllDebtSalesBtn?.addEventListener("click", () =>
  previewAllDebtSales().catch((e) => showToast(e.message))
);
clearClientDebtsBtn?.addEventListener("click", () =>
  clearClientDebts().catch((e) => showToast(e.message))
);
fullDeleteClientBtn?.addEventListener("click", () =>
  fullDeleteClientOperations().catch((e) => showToast(e.message))
);
resyncClientBtn?.addEventListener("click", () =>
  resyncClient().catch((e) => showToast(e.message))
);
importRemoteDebtsBtn?.addEventListener("click", () =>
  importRemoteDebts().catch((e) => showToast(e.message))
);
syncDebtsBtn?.addEventListener("click", () => {
  showToast("Запускаю синхронизацию...");
  triggerDebtSyncRetry({ notify: true });
});

loadClients()
  .then(() => {
    renderClientDebt();
    if (state.clients.length) {
      return selectClient(state.clients[0].id);
    }
    return null;
  })
  .catch((e) => showToast(e.message));

window.addEventListener("online", () => {
  setTimeout(() => triggerDebtSyncRetry({ notify: true }), 1000);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && navigator.onLine) {
    triggerDebtSyncRetry({ notify: true });
  }
});

