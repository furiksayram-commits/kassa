const xReportBox = document.getElementById("xReportBox");
const zReportBox = document.getElementById("zReportBox");
const journalList = document.getElementById("journalList");
const xDateInput = document.getElementById("xDateInput");
const refreshXBtn = document.getElementById("refreshXBtn");
const refreshJournalBtn = document.getElementById("refreshJournalBtn");
const refreshZBtn = document.getElementById("refreshZBtn");
const closeZBtn = document.getElementById("closeZBtn");
const printXBtn = document.getElementById("printXBtn");
const printZBtn = document.getElementById("printZBtn");
const openShiftBtn = document.getElementById("openShiftBtn");
const closeShiftBtn = document.getElementById("closeShiftBtn");
const shiftCashierInput = document.getElementById("shiftCashierInput");
const shiftStateBadge = document.getElementById("shiftStateBadge");
const journalDateFrom = document.getElementById("journalDateFrom");
const journalDateTo = document.getElementById("journalDateTo");
const journalSaleCodeSearch = document.getElementById("journalSaleCodeSearch");
const journalDeliverySearch = document.getElementById("journalDeliverySearch");
const monthlyMonthInput = document.getElementById("monthlyMonthInput");
const loadMonthlyBtn = document.getElementById("loadMonthlyBtn");
const monthlyReportBox = document.getElementById("monthlyReportBox");
const monthlyTopBox = document.getElementById("monthlyTopBox");
const dailyDateInput = document.getElementById("dailyDateInput");
const loadDailyBtn = document.getElementById("loadDailyBtn");
const dailyReportBox = document.getElementById("dailyReportBox");
const dailyServicesBox = document.getElementById("dailyServicesBox");
const zDateFrom = document.getElementById("zDateFrom");
const zDateTo = document.getElementById("zDateTo");
const toast = document.getElementById("toast");
let journalSales = [];
let currentXReport = null;
let currentZReports = [];

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
    if (journalSaleCodeSearch) journalSaleCodeSearch.focus();
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

function requestAdminPin(message) {
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
    title.textContent = "PIN администратора";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "20px";

    const text = document.createElement("div");
    text.textContent = message || "Введите PIN";
    text.style.color = "#4d6075";
    text.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = "password";
    input.inputMode = "numeric";
    input.placeholder = "PIN";
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
    okBtn.textContent = "Подтвердить";

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
  });
}

function formatMoney(value) {
  const amount = Math.round(Number(value || 0));
  return `${amount.toLocaleString("ru-RU")} т`;
}

function formatReportMoney(value) {
  const roundedToHundreds = Math.round(Number(value || 0) / 100) * 100;
  return `${roundedToHundreds.toLocaleString("ru-RU")} т`;
}

function formatReportQty(value) {
  const num = Number(value || 0);
  const rounded = Math.round(num * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/\.?0+$/, "");
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

    const rows = (sale.items || [])
      .map((item, idx) => {
        const qtyValue = sale.isReturn ? Math.abs(Number(item.qty || 0)) : Number(item.qty || 0);
        const lineTotal = qtyValue * Number(item.price || 0);
        const pricePrint = formatPrintAmount(item.price);
        const lineTotalPrint = formatPrintAmount(lineTotal);
        return `
          <tr>
            <td class="name">${idx + 1}. ${esc(item.name)}</td>
            <td class="qty">${esc(formatQtyUnit(qtyValue, item.unit || "шт"))}</td>
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
          :root { --preview-scale: 1.75; }
          html, body { width: 100%; }
          body {
            margin: 0;
            font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
            font-size: 12px;
            line-height: 1.2;
            color: #000;
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
            .receipt-export {
              display: inline-block;
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
            <button id="zoomBtn" title="Масштаб">175%</button>
            <button id="closeBtn">Закрыть</button>
            <button id="whatsappBtn">WhatsApp</button>
            <button id="saveJpegBtn">Скачать чек (JPEG)</button>
            <button id="sendEscPosBtn" class="primary">Отправить на принтер</button>
          </div>
        <div class="preview-wrap">
          <div class="receipt-export">
            <div class="receipt">
              <div class="center">Добро пожаловать</div>
              <div class="center bold">Мерос</div>
              <div class="center muted">Телефон: +7 (702) 913-13-39</div>
              <div class="line"></div>
              <div class="center bold">ЧЕК НА ПРОДАЖУ № ${esc(sale.id)}</div>
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
            <div>Кассир: ${esc(sale.cashier || "-")}</div>
            <div>Оплата: ${paymentLabel(sale.paymentType)}</div>
            ${
              sale.paymentType === "debt" && sale.clientName
                ? `<div>Клиент: ${esc(sale.clientName)}${sale.clientPhone ? `, ${esc(sale.clientPhone)}` : ""}</div>`
                : ""
            }
              ${sale.comment ? `<div class="center bold">${esc(sale.comment)}</div>` : ""}
              <div class="line"></div>
              <div class="center bold">СПАСИБО ЗА ПОКУПКУ!</div>
            </div>
          </div>
        </div>
          <script src="/vendor/html2canvas.min.js"></script>
          <script>
            const sale = ${saleJson};
            const closeBtn = document.getElementById("closeBtn");
            const sendEscPosBtn = document.getElementById("sendEscPosBtn");
            const zoomBtn = document.getElementById("zoomBtn");
            const whatsappBtn = document.getElementById("whatsappBtn");
            const saveJpegBtn = document.getElementById("saveJpegBtn");
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
                const receiptExport = document.querySelector(".receipt-export");
                const receipt = receiptExport?.querySelector(".receipt");
                if (!receiptExport || !receipt) throw new Error("Не найден блок чека");
                const prevTransform = receipt.style.transform;
                const prevOrigin = receipt.style.transformOrigin;
                const prevWidth = receipt.style.width;
                const prevHeight = receipt.style.height;
                const prevExportWidth = receiptExport.style.width;
                const prevExportHeight = receiptExport.style.height;
                receipt.style.transform = "none";
                receipt.style.transformOrigin = "top left";
                receipt.style.width = receipt.scrollWidth + "px";
                receipt.style.height = receipt.scrollHeight + "px";
                receiptExport.style.width = receipt.scrollWidth + "px";
                receiptExport.style.height = receipt.scrollHeight + "px";
                await new Promise((r) => requestAnimationFrame(r));
                const canvas = await html2canvas(receiptExport, {
                  scale: 2,
                  backgroundColor: "#ffffff",
                  width: receiptExport.scrollWidth,
                  height: receiptExport.scrollHeight,
                  windowWidth: receiptExport.scrollWidth,
                  windowHeight: receiptExport.scrollHeight
                });
                receipt.style.transform = prevTransform;
                receipt.style.transformOrigin = prevOrigin;
                receipt.style.width = prevWidth;
                receipt.style.height = prevHeight;
                receiptExport.style.width = prevExportWidth;
                receiptExport.style.height = prevExportHeight;
                const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
                const pad2 = (v) => String(v).padStart(2, "0");
                const stamp = new Date(sale.createdAt || Date.now());
                const datePart =
                  stamp.getFullYear() + "-" + pad2(stamp.getMonth() + 1) + "-" + pad2(stamp.getDate());
                const timePart = pad2(stamp.getHours()) + "-" + pad2(stamp.getMinutes()) + "-" + pad2(stamp.getSeconds());
                const fileName = (sale.clientName ? sale.clientName : "Чек") + " " + datePart + " " + timePart;
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

function renderServiceItemsBlock(serviceItems) {
  const items = Array.isArray(serviceItems) ? serviceItems : [];
  return `
    <div><strong>Доставка</strong></div>
    ${items
      .map((it) => `<div>${it.name}: ${formatReportQty(it.qty)} шт. = ${formatReportMoney(it.amount)}</div>`)
      .join("")}
  `;
}

async function loadMonthlyReport() {
  if (!monthlyReportBox || !monthlyTopBox || !monthlyMonthInput) return;
  const month = monthlyMonthInput?.value;
  if (!month) {
    monthlyReportBox.innerHTML = "<div>Выберите месяц</div>";
    monthlyTopBox.innerHTML = "";
    return;
  }

  const res = await fetch(`/api/reports/monthly?month=${encodeURIComponent(month)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось загрузить месячный отчет");
  }

  const r = await res.json();
  monthlyReportBox.innerHTML = `
    <div>Период: <strong>${new Date(r.periodStart).toLocaleDateString()} - ${new Date(new Date(r.periodEnd).getTime() - 1).toLocaleDateString()}</strong></div>
    <div>Чеков: <strong>${r.checksCount}</strong></div>
    <div>Выручка: <strong>${formatReportMoney(r.revenue)}</strong></div>
    <div>Продано в долг: <strong>${formatReportMoney(r.debtSold || 0)}</strong></div>
    <div>Погашено долгов: <strong>${formatReportMoney(r.debtPaid || 0)}</strong></div>
    <div>Остаток долга: <strong>${formatReportMoney(r.debtOutstanding || 0)}</strong></div>
    <div>Доставка и резка металла: <strong>${formatReportQty(r.servicesQty)}</strong> шт. на <strong>${formatReportMoney(r.servicesAmount)}</strong></div>
    <div>Товары: <strong>${formatReportQty(r.goodsQty)}</strong> шт. на <strong>${formatReportMoney(r.goodsAmount)}</strong></div>
  `;

  monthlyTopBox.innerHTML = renderServiceItemsBlock(r.serviceItems);

  if (!Array.isArray(r.topItems) || r.topItems.length === 0) return;

  monthlyTopBox.innerHTML += `
    <div style="margin-top:10px;"><strong>Топ проданных позиций</strong></div>
    ${r.topItems
      .map(
        (it, i) =>
          `<div>${i + 1}. ${it.name}: ${formatReportQty(it.qty)} шт. = ${formatReportMoney(it.amount)}</div>`
      )
      .join("")}
  `;
}

async function loadDailyReport() {
  if (!dailyReportBox || !dailyServicesBox || !dailyDateInput) return;
  const date = dailyDateInput?.value;
  if (!date) {
    dailyReportBox.innerHTML = "<div>Выберите дату</div>";
    dailyServicesBox.innerHTML = "";
    return;
  }

  const res = await fetch(`/api/reports/daily?date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось загрузить дневной отчет");
  }

  const r = await res.json();
  dailyReportBox.innerHTML = `
    <div>Дата: <strong>${new Date(r.periodStart).toLocaleDateString()}</strong></div>
    <div>Чеков: <strong>${r.checksCount}</strong></div>
    <div>Выручка: <strong>${formatReportMoney(r.revenue)}</strong></div>
    <div>Продано в долг: <strong>${formatReportMoney(r.debtSold || 0)}</strong></div>
    <div>Погашено долгов: <strong>${formatReportMoney(r.debtPaid || 0)}</strong></div>
    <div>Остаток долга: <strong>${formatReportMoney(r.debtOutstanding || 0)}</strong></div>
    <div>Доставка и резка металла: <strong>${formatReportQty(r.servicesQty)}</strong> шт. на <strong>${formatReportMoney(r.servicesAmount)}</strong></div>
    <div>Товары: <strong>${formatReportQty(r.goodsQty)}</strong> шт. на <strong>${formatReportMoney(r.goodsAmount)}</strong></div>
  `;

  dailyServicesBox.innerHTML = renderServiceItemsBlock(r.serviceItems);
}

async function loadXReport() {
  if (!xReportBox) return;
  const params = new URLSearchParams();
  if (xDateInput?.value) params.set("date", xDateInput.value);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/reports/x${suffix}`);
  if (!res.ok) throw new Error("Не удалось загрузить X-отчет");
  const x = await res.json();
  currentXReport = x;

  const byPayment = Object.entries(x.byPayment || {})
    .map(([k, v]) => `<div>${paymentLabel(k)}: <strong>${formatMoney(v)}</strong></div>`)
    .join("");

  xReportBox.innerHTML = `
    <div>Период: <strong>${new Date(x.periodStart).toLocaleString()} - ${new Date(x.periodEnd).toLocaleString()}</strong></div>
    <div>Чеков: <strong>${x.salesCount}</strong></div>
    <div>Выручка: <strong>${formatReportMoney(x.revenue)}</strong></div>
    <div>${byPayment || "Нет данных по оплатам"}</div>
  `;
  if (shiftStateBadge) {
    shiftStateBadge.textContent = x.shift
      ? x.shift.isOpen
        ? "Смена открыта"
        : "Смена закрыта"
      : "X за выбранную дату";
  }
}

async function loadZReports() {
  if (!zReportBox) return;
  const params = new URLSearchParams({ limit: "200" });
  if (zDateFrom?.value) params.set("dateFrom", zDateFrom.value);
  if (zDateTo?.value) params.set("dateTo", zDateTo.value);

  const res = await fetch(`/api/reports/z?${params.toString()}`);
  if (!res.ok) throw new Error("Не удалось загрузить Z-отчеты");
  const list = await res.json();
  currentZReports = list;

  if (list.length === 0) {
    zReportBox.innerHTML = "<div>Пока нет снятых Z-отчетов</div>";
    return;
  }

  zReportBox.innerHTML = list
    .map(
      (z) => `
        <div class="z-row">
          <div><strong>Z #${z.id}</strong> — ${new Date(z.createdAt).toLocaleString()}</div>
          <div>Период: ${new Date(z.periodStart).toLocaleString()} - ${new Date(z.periodEnd).toLocaleString()}</div>
          <div>Чеков: ${z.salesCount} | Выручка: <strong>${formatReportMoney(z.revenue)}</strong> | Нал: ${formatReportMoney(z.cashTotal)} | Карта: ${formatReportMoney(z.cardTotal)}</div>
        </div>
      `
    )
    .join("");
}

async function printReportOnPosPrinter(payload) {
  const res = await fetch("/api/print/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Ошибка печати отчета");
  }
}

async function printXReport() {
  if (!currentXReport) {
    showToast("X-отчет не загружен");
    return;
  }

  try {
    const bodyLines = [
      `Период: ${new Date(currentXReport.periodStart).toLocaleString()} - ${new Date(currentXReport.periodEnd).toLocaleString()}`,
      `Чеков: ${currentXReport.salesCount}`,
      `Выручка: ${formatReportMoney(currentXReport.revenue)}`
    ];
    const byPayment = Object.entries(currentXReport.byPayment || {});
    if (byPayment.length > 0) {
      bodyLines.push("");
      byPayment.forEach(([k, v]) => bodyLines.push(`${paymentLabel(k)}: ${formatReportMoney(v)}`));
    }

    await printReportOnPosPrinter({
      title: "X-ОТЧЕТ",
      bodyLines
    });

    showToast("X-отчет отправлен на печать");
  } catch (err) {
    showToast(err.message);
  }
}

async function printLastZReport() {
  const z = currentZReports[0];
  if (!z) {
    showToast("Нет снятых Z-отчетов");
    return;
  }

  try {
    await printReportOnPosPrinter({
      title: `Z-ОТЧЕТ #${z.id}`,
      bodyLines: [
        `Создан: ${new Date(z.createdAt).toLocaleString()}`,
        `Период: ${new Date(z.periodStart).toLocaleString()} - ${new Date(z.periodEnd).toLocaleString()}`,
        `Чеков: ${z.salesCount}`,
        `Выручка: ${formatReportMoney(z.revenue)}`,
        `Наличные: ${formatReportMoney(z.cashTotal)}`,
        `Карта: ${formatReportMoney(z.cardTotal)}`
      ]
    });

    showToast(`Z-отчет #${z.id} отправлен на печать`);
  } catch (err) {
    showToast(err.message);
  }
}

async function loadJournal() {
  if (!journalList) return;
  const params = new URLSearchParams({ limit: "100" });
  if (journalDateFrom?.value) params.set("dateFrom", journalDateFrom.value);
  if (journalDateTo?.value) params.set("dateTo", journalDateTo.value);
  const saleCodeSearch = String(journalSaleCodeSearch?.value || "").trim();
  if (saleCodeSearch) params.set("saleCode", saleCodeSearch);
  const res = await fetch(`/api/reports/journal?${params.toString()}`);
  if (!res.ok) throw new Error("Не удалось загрузить журнал чеков");
  const list = await res.json();

  // Fallback на клиенте: фильтруем даты даже если бэкенд еще без dateFrom/dateTo.
  const from = journalDateFrom?.value ? new Date(`${journalDateFrom.value}T00:00:00`) : null;
  const to = journalDateTo?.value ? new Date(`${journalDateTo.value}T23:59:59.999`) : null;
  const codeFilter = saleCodeSearch.toLowerCase();
  const deliveryFilter = String(journalDeliverySearch?.value || "").trim().toLowerCase();
  const filtered = list.filter((sale) => {
    const dt = new Date(sale.createdAt);
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    if (codeFilter && !String(sale.id || "").toLowerCase().includes(codeFilter)) return false;
    if (deliveryFilter) {
      const hasDelivery = (sale.items || []).some((item) => {
        const name = String(item.name || "").toLowerCase();
        return name.includes(deliveryFilter);
      });
      if (!hasDelivery) return false;
    }
    return true;
  });

  journalSales = filtered;

  if (filtered.length === 0) {
    journalList.innerHTML = "<p class=\"muted\">Журнал пуст.</p>";
    return;
  }

  journalList.innerHTML = filtered
    .map((sale, idx) => {
      const items = sale.items
        .map((it) => {
          const qtyValue = sale.isReturn ? Math.abs(Number(it.qty || 0)) : Number(it.qty || 0);
          const lineTotal = qtyValue * Number(it.price || 0);
          return `<li>${it.name}: ${qtyValue} ${it.unit || "шт"} x ${formatMoney(it.price)} = ${formatMoney(lineTotal)}</li>`;
        })
        .join("");

      return `
        <article class="journal-item">
          <div class="journal-head">
            <strong>${sale.id}</strong>
            <span>${new Date(sale.createdAt).toLocaleString()}</span>
            <span class="payment-badge ${sale.paymentType}">${paymentLabel(sale.paymentType)}</span>
            ${sale.isReturn ? `<span class="muted">ВОЗВРАТ</span>` : "<span></span>"}
            <strong>${formatMoney(sale.total)}</strong>
          </div>
          ${
            sale.paymentType === "debt" && sale.debtStatus === "paid"
              ? `<div class="payment-badge cash">Погашен</div>`
              : sale.paymentType === "debt" && sale.debtStatus === "partial"
                ? `<div class="payment-badge debt">Погашен частично</div>`
                : ""
          }
          ${
            sale.paymentType === "debt" && sale.clientName
              ? `<div class="muted">Клиент: ${sale.clientName}${sale.clientPhone ? `, ${sale.clientPhone}` : ""}</div>`
              : ""
          }
          ${sale.comment ? `<div class="muted">Комментарий: ${sale.comment}</div>` : ""}
          <div class="journal-actions">
            <button class="btn" data-preview-index="${idx}">Предпросмотр</button>
            <button class="btn" data-print-index="${idx}">Печать</button>
            ${sale.isReturn ? "" : `<button class="btn" data-return-index="${idx}">Возврат</button>`}
            <button class="btn danger" data-delete-index="${idx}">Удалить</button>
          </div>
          <ul>${items}</ul>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-preview-index]").forEach((btn) => {
    btn.addEventListener("click", () => previewJournalSale(Number(btn.dataset.previewIndex)));
  });
  document.querySelectorAll("[data-print-index]").forEach((btn) => {
    btn.addEventListener("click", () => printJournalSale(Number(btn.dataset.printIndex)));
  });
  document.querySelectorAll("[data-return-index]").forEach((btn) => {
    btn.addEventListener("click", () => returnJournalSale(Number(btn.dataset.returnIndex)));
  });
  document.querySelectorAll("[data-delete-index]").forEach((btn) => {
    btn.addEventListener("click", () => deleteJournalSale(Number(btn.dataset.deleteIndex)));
  });
}

function previewJournalSale(index) {
  const sale = journalSales[index];
  if (!sale) {
    showToast("Чек не найден в журнале");
    return;
  }
  openReceiptPreviewWindow(sale);
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

async function returnJournalSale(index) {
  const sale = journalSales[index];
  if (!sale) {
    showToast("Чек не найден в журнале");
    return;
  }
  const res = await fetch(`/api/sales/${encodeURIComponent(sale.id)}`);
  const fullSale = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(fullSale.error || "Не удалось загрузить чек");
    return;
  }
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
  const reloads = [loadJournal()];
  if (xReportBox) reloads.push(loadXReport());
  if (monthlyReportBox) reloads.push(loadMonthlyReport());
  if (dailyReportBox) reloads.push(loadDailyReport());
  await Promise.all(reloads);
}

async function printJournalSale(index) {
  const sale = journalSales[index];
  if (!sale) {
    showToast("Чек не найден в журнале");
    return;
  }

  try {
    const res = await fetch("/api/print/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sale })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Ошибка печати чека");
    }

    showToast(`Чек ${sale.id} отправлен на печать`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteJournalSale(index) {
  const sale = journalSales[index];
  if (!sale) {
    showToast("Чек не найден в журнале");
    return;
  }

  const ok = await requestConfirm(`Удалить продажу ${sale.id}?`, {
    title: "Удаление чека",
    yesText: "Удалить",
    noText: "Отмена"
  });
  if (!ok) return;

  try {
    const payload = {};
    if (sale.paymentType === "debt") {
      const adminPin = await requestAdminPin("Введите PIN администратора для удаления чека в долг:");
      if (adminPin === null) return;
      payload.adminPin = String(adminPin).trim();
    }
    const res = await fetch(`/api/sales/${encodeURIComponent(sale.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Ошибка удаления чека");
    }

    showToast(`Чек ${sale.id} удален`);
    const reloads = [loadJournal()];
    if (xReportBox) reloads.push(loadXReport());
    if (monthlyReportBox) reloads.push(loadMonthlyReport());
    if (dailyReportBox) reloads.push(loadDailyReport());
    await Promise.all(reloads);
  } catch (err) {
    showToast(err.message);
  }
}

async function closeZReport() {
  if (!closeZBtn) return;
  closeZBtn.disabled = true;
  try {
    const res = await fetch("/api/reports/z/close", { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Не удалось снять Z-отчет");
    }

    showToast("Z-отчет снят");
    const reloads = [];
    if (xReportBox) reloads.push(loadXReport());
    if (zReportBox) reloads.push(loadZReports());
    if (journalList) reloads.push(loadJournal());
    await Promise.all(reloads);
  } catch (err) {
    showToast(err.message);
  } finally {
    closeZBtn.disabled = false;
  }
}

async function openShift() {
  if (!openShiftBtn || !shiftCashierInput) return;
  openShiftBtn.disabled = true;
  try {
    const res = await fetch("/api/shifts/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cashier: shiftCashierInput.value.trim() || "Кассир 1" })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Не удалось открыть смену");
    }
    showToast("Смена открыта");
    await loadXReport();
  } catch (err) {
    showToast(err.message);
  } finally {
    openShiftBtn.disabled = false;
  }
}

async function closeShift() {
  if (!closeShiftBtn) return;
  closeShiftBtn.disabled = true;
  try {
    const res = await fetch("/api/shifts/close", { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Не удалось закрыть смену");
    }
    showToast("Смена закрыта");
    await loadXReport();
  } catch (err) {
    showToast(err.message);
  } finally {
    closeShiftBtn.disabled = false;
  }
}

refreshXBtn?.addEventListener("click", () => loadXReport().catch((e) => showToast(e.message)));
refreshZBtn?.addEventListener("click", () => loadZReports().catch((e) => showToast(e.message)));
refreshJournalBtn?.addEventListener("click", () => loadJournal().catch((e) => showToast(e.message)));
journalDateFrom?.addEventListener("change", () => loadJournal().catch((e) => showToast(e.message)));
journalDateTo?.addEventListener("change", () => loadJournal().catch((e) => showToast(e.message)));
journalSaleCodeSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  loadJournal().catch((e) => showToast(e.message));
});
journalDeliverySearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  loadJournal().catch((e) => showToast(e.message));
});
journalDeliverySearch?.addEventListener("input", () => loadJournal().catch((e) => showToast(e.message)));
closeZBtn?.addEventListener("click", closeZReport);
printXBtn?.addEventListener("click", printXReport);
printZBtn?.addEventListener("click", printLastZReport);
openShiftBtn?.addEventListener("click", openShift);
closeShiftBtn?.addEventListener("click", closeShift);
xDateInput?.addEventListener("change", () => loadXReport().catch((e) => showToast(e.message)));
loadMonthlyBtn?.addEventListener("click", () => loadMonthlyReport().catch((e) => showToast(e.message)));
loadDailyBtn?.addEventListener("click", () => loadDailyReport().catch((e) => showToast(e.message)));

const today = new Date().toISOString().slice(0, 10);
if (xDateInput) xDateInput.value = today;
if (journalDateFrom) journalDateFrom.value = today;
if (journalDateTo) journalDateTo.value = today;
if (monthlyMonthInput) monthlyMonthInput.value = today.slice(0, 7);
if (dailyDateInput) dailyDateInput.value = today;
if (zDateFrom) zDateFrom.value = today;
if (zDateTo) zDateTo.value = today;

const startupTasks = [];
if (xReportBox) startupTasks.push(loadXReport());
if (zReportBox) startupTasks.push(loadZReports());
if (journalList) startupTasks.push(loadJournal());
if (monthlyReportBox) startupTasks.push(loadMonthlyReport());
if (dailyReportBox) startupTasks.push(loadDailyReport());
Promise.all(startupTasks).catch((e) => showToast(e.message));
