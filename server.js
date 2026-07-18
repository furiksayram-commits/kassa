const express = require("express");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");
const iconv = require("iconv-lite");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.KASSA_DATA_DIR
  ? path.resolve(process.env.KASSA_DATA_DIR)
  : path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "kassa.db");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const DEFAULT_PRINT_CONFIG = {
  transport: (process.env.PRINTER_TRANSPORT || "tcp").toLowerCase(),
  host: process.env.PRINTER_HOST || "127.0.0.1",
  port: Number(process.env.PRINTER_PORT || 9100),
  comPort: process.env.PRINTER_COM_PORT || "COM3",
  comBaudRate: Number(process.env.PRINTER_COM_BAUD || 9600),
  charsPerLine: Number(process.env.PRINTER_CHARS || 42),
  codePage: Number(process.env.PRINTER_CODEPAGE || 17)
};
const DEFAULT_REMOTE_DEBT_BASE_URL =
  process.env.REMOTE_DEBT_BASE_URL || "https://debt-tracker-477415.lm.r.appspot.com";
const REMOTE_DEBT_TIMEOUT_MS = Number(process.env.REMOTE_DEBT_TIMEOUT_MS || 12000);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOAD_DIR });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function mapShift(row) {
  return {
    isOpen: Boolean(row?.is_open),
    openedAt: row?.opened_at || null,
    closedAt: row?.closed_at || null,
    cashier: row?.cashier || null
  };
}

async function getSetting(key, fallbackValue) {
  const row = await get("SELECT value FROM app_settings WHERE key = ?", [key]);
  return row ? row.value : fallbackValue;
}

async function setSetting(key, value) {
  await run(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, String(value)]
  );
}

async function ensureDefaultSetting(key, value) {
  const existing = await get("SELECT value FROM app_settings WHERE key = ?", [key]);
  if (!existing) {
    await setSetting(key, value);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nextRetryIso(attempts) {
  const safeAttempts = Math.max(1, Number(attempts || 1));
  const delayMinutes = Math.min(60, 2 ** Math.min(safeAttempts - 1, 6)); // 1,2,4,8,16,32,60...
  const d = new Date();
  d.setMinutes(d.getMinutes() + delayMinutes);
  return d.toISOString();
}

function normalizeRemoteBaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("remoteBaseUrl должен начинаться с http:// или https://");
  }
  return url;
}

function normalizeRemoteDebtorId(value) {
  const id = String(value || "").trim();
  return id ? id.slice(0, 80) : "";
}

function normalizeIsoDateOrNow(value) {
  const iso = String(value || "").trim();
  const dt = iso ? new Date(iso) : null;
  if (dt && !Number.isNaN(dt.getTime())) {
    return dt.toISOString();
  }
  return new Date().toISOString();
}

async function getRemoteDebtBaseUrl() {
  const raw = await getSetting("debt.remoteBaseUrl", DEFAULT_REMOTE_DEBT_BASE_URL);
  return normalizeRemoteBaseUrl(raw);
}

async function isRemoteDebtSyncEnabled() {
  const raw = String(await getSetting("debt.remoteSyncEnabled", "1")).trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(raw);
}

async function remoteDebtApi(pathname, options = {}) {
  const baseUrl = await getRemoteDebtBaseUrl();
  const url = `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_DEBT_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = text;
      }
    }
    if (!res.ok) {
      const message =
        (data && typeof data === "object" && data.error) ||
        `Remote API ${res.status}: ${res.statusText}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCategoryName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Название категории обязательно");
  if (name.length > 80) throw new Error("Название категории слишком длинное");
  return name;
}

async function ensureCategoryExists(name) {
  const normalized = normalizeCategoryName(name);
  await run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [normalized]);
  return normalized;
}

async function getPrintConfig() {
  const transport = String(
    await getSetting("printer.transport", DEFAULT_PRINT_CONFIG.transport)
  ).toLowerCase();
  const host = await getSetting("printer.host", DEFAULT_PRINT_CONFIG.host);
  const port = Number(await getSetting("printer.port", DEFAULT_PRINT_CONFIG.port));
  const comPort = String(await getSetting("printer.comPort", DEFAULT_PRINT_CONFIG.comPort)).toUpperCase();
  const comBaudRate = Number(
    await getSetting("printer.comBaudRate", DEFAULT_PRINT_CONFIG.comBaudRate)
  );
  const charsPerLine = Number(
    await getSetting("printer.charsPerLine", DEFAULT_PRINT_CONFIG.charsPerLine)
  );
  const codePage = Number(await getSetting("printer.codePage", DEFAULT_PRINT_CONFIG.codePage));

  return { transport, host, port, comPort, comBaudRate, charsPerLine, codePage };
}

async function getLastZAt() {
  return await getSetting("reports.lastZAt", "1970-01-01T00:00:00.000Z");
}

async function setLastZAt(value) {
  await setSetting("reports.lastZAt", value);
}

async function getAndReserveNextSaleCode() {
  const key = "sales.nextNumber";
  const row = await get("SELECT value FROM app_settings WHERE key = ?", [key]);

  let next = Number(row?.value);
  if (!Number.isInteger(next) || next < 100) {
    const maxRow = await get(
      `SELECT MAX(CAST(sale_code AS INTEGER)) as maxCode
       FROM sales
       WHERE sale_code <> '' AND sale_code NOT GLOB '*[^0-9]*'`
    );
    const maxCode = Number(maxRow?.maxCode || 0);
    next = maxCode >= 100 ? maxCode + 1 : 100;
  }

  await setSetting(key, next + 1);
  return String(next);
}

async function getAndReserveNextStockCode() {
  const key = "stock.nextNumber";
  const row = await get("SELECT value FROM app_settings WHERE key = ?", [key]);

  let next = Number(row?.value);
  if (!Number.isInteger(next) || next < 1) {
    const maxRow = await get(
      `SELECT MAX(CAST(code AS INTEGER)) as maxCode
       FROM stock_receipts
       WHERE code <> '' AND code NOT GLOB '*[^0-9]*'`
    );
    const maxCode = Number(maxRow?.maxCode || 0);
    next = maxCode >= 1 ? maxCode + 1 : 1;
  }

  await setSetting(key, next + 1);
  return String(next);
}

function validatePrintConfig(config) {
  if (!["tcp", "com"].includes(config.transport)) {
    throw new Error("transport должен быть tcp или com");
  }

  if (config.transport === "tcp") {
    if (!config.host || typeof config.host !== "string") {
      throw new Error("Неверный host принтера");
    }
    if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
      throw new Error("Неверный port принтера");
    }
  }

  if (config.transport === "com") {
    if (!config.comPort || !/^COM\d+$/i.test(String(config.comPort))) {
      throw new Error("Неверный COM порт, пример: COM322");
    }
    if (!Number.isInteger(config.comBaudRate) || config.comBaudRate <= 0) {
      throw new Error("Неверная скорость COM (baud rate)");
    }
  }

  if (!Number.isInteger(config.charsPerLine) || config.charsPerLine < 20 || config.charsPerLine > 80) {
    throw new Error("charsPerLine должен быть от 20 до 80");
  }
  if (!Number.isInteger(config.codePage) || config.codePage < 0 || config.codePage > 255) {
    throw new Error("Неверная codePage");
  }
}

async function savePrintConfig(partialConfig) {
  const current = await getPrintConfig();
  const pickNumber = (incoming, fallback) =>
    Number.isFinite(incoming) ? incoming : fallback;

  const next = {
    transport: (partialConfig.transport ?? current.transport).toLowerCase(),
    host: partialConfig.host ?? current.host,
    port: pickNumber(partialConfig.port, current.port),
    comPort: String(partialConfig.comPort ?? current.comPort).toUpperCase(),
    comBaudRate: pickNumber(partialConfig.comBaudRate, current.comBaudRate),
    charsPerLine: pickNumber(partialConfig.charsPerLine, current.charsPerLine),
    codePage: pickNumber(partialConfig.codePage, current.codePage)
  };

  validatePrintConfig(next);

  await setSetting("printer.transport", next.transport);
  await setSetting("printer.host", next.host);
  await setSetting("printer.port", next.port);
  await setSetting("printer.comPort", next.comPort);
  await setSetting("printer.comBaudRate", next.comBaudRate);
  await setSetting("printer.charsPerLine", next.charsPerLine);
  await setSetting("printer.codePage", next.codePage);

  return next;
}

function padRight(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : " ".repeat(width - text.length) + text;
}

function wrapText(text, width) {
  const normalized = String(text || "").trim();
  if (!normalized) return [""];

  const words = normalized.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      if (word.length <= width) {
        line = word;
      } else {
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
      }
      continue;
    }

    if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      if (word.length <= width) {
        line = word;
      } else {
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        line = "";
      }
    }
  }

  if (line) lines.push(line);
  return lines;
}

function formatPrintAmount(value) {
  const num = Math.round(Number(value || 0));
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatPrintQty(value) {
  const num = Number(value || 0);
  if (Number.isInteger(num)) return String(num);
  return String(num).replace(/\.?0+$/, "");
}

function formatCommentPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 11) return text;
  if (text.replace(/[+\d\s()-]/g, "") !== "") return text;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

function paymentTypeLabel(type) {
  if (type === "card") return "Карта";
  if (type === "debt") return "В долг";
  return "Наличные";
}

function isDeliveryReceiptItem(item) {
  const name = String(item?.name || "").trim().toLowerCase();
  return name === "доставка";
}

function buildEscPosReceipt(sale, printerConfig) {
  const width = printerConfig.charsPerLine;
  const totalWidth = 10;
  const nameWidth = Math.max(Math.min(Math.floor(width * 0.45), width - totalWidth - 8), 10);
  const middleWidth = Math.max(width - nameWidth - totalWidth, 8);
  const buffers = [];

  const cmd = (...bytes) => buffers.push(Buffer.from(bytes));
  const txt = (line = "") => buffers.push(iconv.encode(`${line}\n`, "cp866"));
  const hr = () => txt("-".repeat(width));

  const align = (mode) => cmd(0x1b, 0x61, mode);
  const bold = (on) => cmd(0x1b, 0x45, on ? 1 : 0);
  const fontSize = (value) => cmd(0x1d, 0x21, value);

  const soldAt = new Date(sale.createdAt || Date.now());
  const docDate = soldAt.toLocaleDateString("ru-RU");
  const docTime = soldAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  cmd(0x1b, 0x40);
  cmd(0x1b, 0x74, printerConfig.codePage);
  cmd(0x1b, 0x4d, 0x00); // ESC M 0 - Font A (standard printer built-in font)
  fontSize(0x00);
  bold(false);

  align(1);
  txt("Добро пожаловать");
  bold(true);
  txt("МЕРОС");
  bold(false);
   txt("Телефон: +7 (702) 913-13-39");
  hr();

  bold(true);
  txt(`ЧЕК НА ПРОДАЖУ N ${sale.id || "-"}`);
  bold(false);
  txt(`от ${docDate} ${docTime}`);
  if (sale.isReturn) {
    bold(true);
    txt("ВОЗВРАТ");
    bold(false);
  }
  hr();

  align(0);
  txt(
    padRight("Наименование", nameWidth) +
      padRight("Кол Ед x Цена =", middleWidth) +
      padLeft("Итог", totalWidth)
  );
  hr();

  const items = [...sale.items].sort((a, b) => {
    const aDelivery = isDeliveryReceiptItem(a);
    const bDelivery = isDeliveryReceiptItem(b);
    if (aDelivery && !bDelivery) return 1;
    if (!aDelivery && bDelivery) return -1;
    return 0;
  });

  for (const item of items) {
    const qty = Number(item.qty || 0);
    const qtyPrint = formatPrintQty(sale.isReturn ? Math.abs(qty) : qty);
    const unitPrint = normalizeUnit(item.unit || "шт");
    const price = Number(item.price || 0);
    const lineTotal = qty * price;
    const pricePrint = formatPrintAmount(price);
    const lineTotalPrint = formatPrintAmount(sale.isReturn ? Math.abs(lineTotal) : lineTotal);
    const nameLines = wrapText(item.name || "", nameWidth);

    txt(
      padRight(nameLines[0], nameWidth) +
        padRight(`${qtyPrint} ${unitPrint} x ${pricePrint} =`, middleWidth) +
        padLeft(lineTotalPrint, totalWidth)
    );

    for (let i = 1; i < nameLines.length; i += 1) {
      txt(padRight(nameLines[i], nameWidth));
    }
  }

  hr();
  txt(`Всего наименований: ${items.length}`);
  bold(true);
  fontSize(0x10);
  const totalText = `${formatPrintAmount(sale.total)} т`;
  txt(padRight("ИТОГО:", Math.max(width - totalText.length, 0)) + totalText);
  fontSize(0x00);
  bold(false);
  hr();
  txt(`Кассир: ${sale.cashier || "-"}`);
  txt(`Оплата: ${paymentTypeLabel(sale.paymentType)}`);
  if (sale.clientName) {
    txt(`Клиент: ${String(sale.clientName)}`);
    if (sale.clientPhone) {
      txt(`Телефон: ${String(sale.clientPhone)}`);
    }
  }
  if (sale.comment) {
    align(1);
    bold(true);
    fontSize(0x10);
    const commentLines = wrapText(formatCommentPhone(sale.comment), width);
    for (const line of commentLines) txt(line);
    bold(false);
    fontSize(0x00);
    align(0);
  }
  hr();
  align(1);
  bold(true);
  txt("СПАСИБО ЗА ПОКУПКУ!");
  bold(false);

  cmd(0x1b, 0x64, 0x04); // feed before cut
  cmd(0x1b, 0x69); // ESC i - single full cut on many Posiflex models

  return Buffer.concat(buffers);
}

function buildEscPosReport(report, printerConfig) {
  const width = printerConfig.charsPerLine;
  const buffers = [];

  const cmd = (...bytes) => buffers.push(Buffer.from(bytes));
  const txt = (line = "") => buffers.push(iconv.encode(`${line}\n`, "cp866"));
  const hr = () => txt("-".repeat(width));

  const align = (mode) => cmd(0x1b, 0x61, mode);
  const bold = (on) => cmd(0x1b, 0x45, on ? 1 : 0);

  cmd(0x1b, 0x40);
  cmd(0x1b, 0x74, printerConfig.codePage);

  align(1);
  bold(true);
  txt(String(report.title || "ОТЧЕТ").slice(0, width));
  bold(false);

  if (Array.isArray(report.headerLines)) {
    for (const line of report.headerLines) {
      txt(String(line || "").slice(0, width));
    }
  }

  hr();
  align(0);

  if (Array.isArray(report.bodyLines)) {
    for (const line of report.bodyLines) {
      const chunks = wrapText(String(line || ""), width);
      for (const chunk of chunks) {
        txt(chunk);
      }
    }
  }

  hr();
  align(1);
  txt(new Date().toLocaleString("ru-RU"));

  cmd(0x1b, 0x64, 0x04);
  cmd(0x1b, 0x69);

  return Buffer.concat(buffers);
}

function buildEscPosStockReceipt(receipt, printerConfig) {
  const width = printerConfig.charsPerLine;
  const buffers = [];

  const cmd = (...bytes) => buffers.push(Buffer.from(bytes));
  const txt = (line = "") => buffers.push(iconv.encode(`${line}\n`, "cp866"));
  const hr = () => txt("-".repeat(width));

  const align = (mode) => cmd(0x1b, 0x61, mode);
  const bold = (on) => cmd(0x1b, 0x45, on ? 1 : 0);
  const fontSize = (value) => cmd(0x1d, 0x21, value);

  const createdAt = new Date(receipt.createdAt || Date.now());
  const docDate = createdAt.toLocaleDateString("ru-RU");

  cmd(0x1b, 0x40);
  cmd(0x1b, 0x74, printerConfig.codePage);
  cmd(0x1b, 0x4d, 0x00);
  fontSize(0x00);
  bold(false);

  align(1);
  bold(true);
  txt("МЕРОС");
  bold(false);
  txt("ПРИХОД ТОВАРА");
  hr();

  bold(true);
  txt(`#${receipt.code || "-"}`);
  bold(false);
  txt(docDate);
  hr();

  align(0);

for (const item of receipt.items) {
    const qty = Number(item.qty || 0);
    const qtyPrint = formatPrintQty(qty);
    const unitPrint = normalizeUnit(item.unit || "шт");
    const costPrice = Number(item.costPrice || 0);
    const price = Number(item.price || 0);
    const minPrice = item.minPrice ? Number(item.minPrice) : Number(item.price || 0);
    const costLineTotal = qty * costPrice;
    const priceLineTotal = qty * minPrice;
    const costPrint = formatPrintAmount(costPrice);
    const pricePrint = formatPrintAmount(minPrice);
    const costTotalPrint = formatPrintAmount(costLineTotal);
    const priceTotalPrint = formatPrintAmount(priceLineTotal);

    // Format: имя товара слева, цена справа, количество + итог на следующей строке
    const pricePart = `[${costPrint}] / ${pricePrint}`;
    const qtyPart = `${qtyPrint}${unitPrint}`;
    const totalPart = `= [${costTotalPrint}] / ${priceTotalPrint}`;

    // Имя товара слева, цена справа
    txt(padRight(item.name || "", width - pricePart.length) + pricePart);

    // Количество слева, итог справа
    txt(padRight(qtyPart, width - totalPart.length) + totalPart);
    txt(""); // Empty line after each item
  }

  hr();
  txt("");
  bold(true);
  fontSize(0x10);

  // Финальный итог на двух строках
  const costText = `${formatPrintAmount(receipt.totalCost)} т`;
  const retailText = `${formatPrintAmount(receipt.totalRetail)} т`;

  // Строка 1: Закуп слева
  const buyPart = `Закуп: ${costText}`;
  txt(buyPart);

  // Строка 2: Приход справа
  const sellPart = `Приход: ${retailText}`;
  txt(padLeft(sellPart, width));

  fontSize(0x00);
  bold(false);
  hr();
  align(1);
  bold(true);
  txt("СПАСИБО!");
  bold(false);

  cmd(0x1b, 0x64, 0x04);
  cmd(0x1b, 0x69);

  return Buffer.concat(buffers);
}

function sendToPrinterTcp(buffer, printerConfig) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: printerConfig.host, port: printerConfig.port });
    socket.setTimeout(5000);

    socket.on("connect", () => {
      socket.write(buffer, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Таймаут подключения к принтеру"));
    });

    socket.on("error", (err) => {
      reject(err);
    });

    socket.on("close", (hadError) => {
      if (!hadError) resolve();
    });
  });
}

function configureComPort(portName, baudRate) {
  return new Promise((resolve, reject) => {
    exec(
      `mode ${portName} BAUD=${baudRate} PARITY=n DATA=8 STOP=1`,
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(new Error(`Не удалось настроить ${portName}. Запустите кассу от имени администратора или проверьте, что порт свободен.`));
          return;
        }
        resolve();
      }
    );
  });
}

async function sendToPrinterCom(buffer, printerConfig) {
  const portName = printerConfig.comPort.toUpperCase();
  const devicePath = `\\\\.\\${portName}`;

  let configureError = null;
  try {
    await configureComPort(portName, printerConfig.comBaudRate);
  } catch (err) {
    configureError = err;
  }

  let fd;
  try {
    fd = await fs.promises.open(devicePath, "w");
  } catch (err) {
    if (configureError) {
      throw new Error(`${configureError.message} ${err.message || ""}`.trim());
    }
    throw err;
  }
  try {
    await fd.write(buffer, 0, buffer.length, null);
  } finally {
    await fd.close();
  }
}

async function sendToPrinter(buffer, printerConfig) {
  if (printerConfig.transport === "com") {
    return sendToPrinterCom(buffer, printerConfig);
  }
  return sendToPrinterTcp(buffer, printerConfig);
}

function normalizeSalePayload(payload) {
  const sale = payload?.sale || payload;
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error("Нет данных чека для печати");
  }
  const isReturn = Boolean(sale.isReturn);

  const items = sale.items.map((item) => {
    const qty = Number(item.qty);
    const price = Number(item.price);
    const unit = normalizeUnit(item.unit || "шт");
    const validQty = isReturn ? qty < 0 : qty > 0;
    if (!item.name || !Number.isFinite(qty) || !validQty || !Number.isFinite(price) || price <= 0) {
      throw new Error("Некорректные данные позиции чека");
    }
    return { name: String(item.name), qty: Number(qty.toFixed(3)), unit, price };
  });

  return {
    id: sale.id || `S-${Date.now()}`,
    createdAt: sale.createdAt || new Date().toISOString(),
    cashier: sale.cashier || "Кассир",
    paymentType: sale.paymentType || "cash",
    clientId: sale.clientId ? Number(sale.clientId) : null,
    clientName: String(sale.clientName || "").trim(),
    clientPhone: String(sale.clientPhone || "").trim(),
    debtTotal: Number(sale.debtTotal || 0),
    comment: formatCommentPhone(String(sale.comment || "").trim().slice(0, 120)),
    total: Number(sale.total || items.reduce((acc, item) => acc + item.qty * item.price, 0).toFixed(2)),
    isReturn,
    items
  };
}

function makeProductId() {
  return `p-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeAutoSku() {
  return `AUTO-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
}

function normalizeSku(value) {
  return String(value || "").trim();
}

const ALLOWED_UNITS = new Set(["м", "шт", "кв", "кг"]);

function normalizeUnit(value) {
  const unit = String(value || "шт").trim().toLowerCase();
  if (!ALLOWED_UNITS.has(unit)) {
    throw new Error("Единица измерения: м, шт, кв или кг");
  }
  return unit;
}

function normalizeProductPayload(payload) {
  const incomingSku = normalizeSku(payload?.sku);
  const sku = incomingSku || makeAutoSku();
  const name = String(payload?.name || "").trim();
  const category = String(payload?.category || "").trim();
  const price = Number(payload?.price);
  const minPriceRaw = payload?.minPrice ?? payload?.min_price;
  const unit = normalizeUnit(payload?.unit);
  const minPrice =
    minPriceRaw === undefined || minPriceRaw === null || String(minPriceRaw).trim() === ""
      ? price
      : Number(minPriceRaw);

  if (!name) throw new Error("Название товара обязательно");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Цена должна быть больше 0");
  if (!Number.isFinite(minPrice) || minPrice <= 0) {
    throw new Error("Мин. цена должна быть больше 0");
  }
  if (minPrice > price) {
    throw new Error("Мин. цена не может быть больше цены");
  }

  return {
    sku,
    name,
    category: category || "Без категории",
    price: Number(price.toFixed(2)),
    minPrice: Number(minPrice.toFixed(2)),
    unit,
    stock: 0
  };
}

function parseImportRowsFromWorkbook(workbook) {
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
}

const FIXED_REPORT_SERVICE_ITEMS = [
  { label: "Доставка", aliases: ["доставка"] },
  { label: "Доставка 191", aliases: ["доставка 191"] },
  { label: "Доставка 233", aliases: ["доставка 233"] },
  { label: "Доставка 853", aliases: ["доставка 853"] },
  { label: "Резка", aliases: ["резка", "резка металла"] }
];

function normalizeReportName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildFixedServiceItems(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = normalizeReportName(row.name);
    if (!key) continue;
    const prev = byName.get(key) || { qty: 0, amount: 0 };
    prev.qty += Number(row.qtyTotal || 0);
    prev.amount += Number(row.amountTotal || 0);
    byName.set(key, prev);
  }

  return FIXED_REPORT_SERVICE_ITEMS.map((service) => {
    let qty = 0;
    let amount = 0;
    service.aliases.forEach((alias) => {
      const found = byName.get(alias);
      if (!found) return;
      qty += Number(found.qty || 0);
      amount += Number(found.amount || 0);
    });
    return {
      name: service.label,
      qty,
      amount
    };
  });
}

function normalizeClientName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Имя клиента обязательно");
  if (name.length > 120) throw new Error("Имя клиента слишком длинное");
  return name;
}

function normalizeClientPhone(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+()\-\s]/g, "")
    .slice(0, 32);
}

function normalizeClientNote(value) {
  return String(value || "").trim().slice(0, 240);
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function resolveRemoteDebtorIdByNamePhone(name, phone) {
  const q = encodeURIComponent(String(name || "").trim());
  if (!q) return "";
  let list = [];
  try {
    const found = await remoteDebtApi(`/api/debts/search?q=${q}`);
    if (Array.isArray(found)) {
      list = found;
    }
  } catch (_) {
    const allDebts = await remoteDebtApi("/api/debts");
    if (Array.isArray(allDebts)) {
      list = allDebts.filter((d) =>
        String(d?.name || "")
          .toLowerCase()
          .includes(String(name || "").trim().toLowerCase())
      );
    }
  }

  const nameNorm = String(name || "").trim().toLowerCase();
  const phoneNorm = normalizePhoneDigits(phone);
  let match = list.find((d) => String(d?.name || "").trim().toLowerCase() === nameNorm);
  if (phoneNorm) {
    match =
      list.find((d) => normalizePhoneDigits(d?.phone) === phoneNorm && String(d?.name || "").trim().toLowerCase() === nameNorm) ||
      list.find((d) => normalizePhoneDigits(d?.phone) === phoneNorm) ||
      match;
  }
  return normalizeRemoteDebtorId(match?.id);
}

async function getRemoteDebtorById(remoteDebtorId) {
  const list = await remoteDebtApi("/api/debts");
  if (!Array.isArray(list)) return null;
  return list.find((d) => String(d?.id || "") === String(remoteDebtorId || "")) || null;
}

async function findRemoteRecordIdForMarker(remoteDebtorId, type, amount, marker) {
  const debtor = await getRemoteDebtorById(remoteDebtorId);
  if (!debtor || !Array.isArray(debtor.debts)) return "";
  const targetAmount = Number(Number(amount || 0).toFixed(2));
  const markerText = String(marker || "").trim();
  const rows = debtor.debts
    .filter((r) => String(r?.type || "").toLowerCase() === String(type || "").toLowerCase())
    .filter((r) => Number(Number(r?.amount || 0).toFixed(2)) === targetAmount)
    .filter((r) => String(r?.comment || "").includes(markerText))
    .sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());
  const row = rows[0];
  return row ? String(row.id || "") : "";
}

async function deleteRemoteRecord(remoteDebtorId, remoteRecordId) {
  if (!remoteDebtorId || !remoteRecordId) return false;
  await remoteDebtApi(
    `/api/debts/${encodeURIComponent(remoteDebtorId)}/records/${encodeURIComponent(remoteRecordId)}`,
    { method: "DELETE" }
  );
  return true;
}

async function tryDeleteRemoteDebtRecordByLocalSale(client, sale) {
  if (!(await isRemoteDebtSyncEnabled())) return;
  const remoteDebtorId = normalizeRemoteDebtorId(client?.externalDebtorId || client?.external_debtor_id);
  if (!remoteDebtorId) return;

  const mapped = await get(
    "SELECT remote_record_id as remoteRecordId FROM debt_sync_records WHERE local_sale_id = ? AND record_type = 'debt' ORDER BY imported_at DESC LIMIT 1",
    [Number(sale?.dbId || sale?.id || 0)]
  );
  let remoteRecordId = "";
  if (mapped?.remoteRecordId) {
    const parts = String(mapped.remoteRecordId).split(":");
    remoteRecordId = parts.length >= 2 ? parts.slice(1).join(":") : "";
  }
  if (!remoteRecordId) {
    const saleCode = String(sale?.id || sale?.saleCode || "").trim();
    const marker = `[KASSA_SALE:${saleCode}]`;
    const amount = Number(sale?.debtTotal ?? sale?.total ?? 0);
    remoteRecordId = await findRemoteRecordIdForMarker(remoteDebtorId, "debt", amount, marker);
  }
  if (!remoteRecordId) return;
  await deleteRemoteRecord(remoteDebtorId, remoteRecordId);
  await run("DELETE FROM debt_sync_records WHERE remote_record_id = ?", [
    `${remoteDebtorId}:${remoteRecordId}`
  ]);
}

async function tryDeleteRemotePaymentRecordByLocalPayment(client, paymentId) {
  if (!(await isRemoteDebtSyncEnabled())) return;
  const remoteDebtorId = normalizeRemoteDebtorId(client?.externalDebtorId || client?.external_debtor_id);
  if (!remoteDebtorId || !paymentId) return;
  const mapped = await get(
    "SELECT remote_record_id as remoteRecordId FROM debt_sync_records WHERE local_payment_id = ? AND record_type = 'payment' ORDER BY imported_at DESC LIMIT 1",
    [Number(paymentId)]
  );
  if (!mapped?.remoteRecordId) return;
  const parts = String(mapped.remoteRecordId).split(":");
  const remoteRecordId = parts.length >= 2 ? parts.slice(1).join(":") : "";
  if (!remoteRecordId) return;
  await deleteRemoteRecord(remoteDebtorId, remoteRecordId);
  await run("DELETE FROM debt_sync_records WHERE remote_record_id = ?", [
    `${remoteDebtorId}:${remoteRecordId}`
  ]);
}

async function enqueueRemoteSyncOp(opType, clientId, payload, errorMessage = "") {
  const createdAt = nowIso();
  await run(
    `INSERT INTO debt_sync_outbox
      (op_type, client_id, payload_json, attempts, next_retry_at, last_error, done, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)`,
    [
      String(opType || "").trim(),
      Number(clientId || 0) || null,
      JSON.stringify(payload || {}),
      createdAt,
      String(errorMessage || "").slice(0, 500),
      createdAt,
      createdAt
    ]
  );
}

async function processOneOutboxRow(row) {
  const payload = (() => {
    try {
      return JSON.parse(String(row.payload_json || "{}"));
    } catch (_) {
      return {};
    }
  })();
  const clientId = Number(row.client_id || 0);
  const client =
    clientId > 0
      ? await get(
          "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
          [clientId]
        )
      : null;

  switch (row.op_type) {
    case "sale_add":
      if (!client) throw new Error("Клиент не найден для sale_add");
      await syncLocalDebtSaleToRemote(client, payload.sale || {});
      return;
    case "payment_add":
      if (!client) throw new Error("Клиент не найден для payment_add");
      await syncLocalDebtPaymentToRemote(client, payload.payment || {});
      return;
    case "sale_delete":
      if (!client) return;
      await tryDeleteRemoteDebtRecordByLocalSale(client, payload.sale || {});
      return;
    case "payment_delete":
      if (!client) return;
      await tryDeleteRemotePaymentRecordByLocalPayment(client, Number(payload.paymentId || 0));
      return;
    case "client_clear_history": {
      if (!client) return;
      const remoteDebtorId = normalizeRemoteDebtorId(client.externalDebtorId);
      if (!remoteDebtorId) return;
      await remoteDebtApi(`/api/debts/${encodeURIComponent(remoteDebtorId)}/history`, {
        method: "DELETE"
      });
      return;
    }
    default:
      throw new Error(`Неизвестный тип outbox операции: ${row.op_type}`);
  }
}

let outboxProcessing = false;
async function processRemoteSyncOutbox(limit = 20) {
  if (outboxProcessing) return;
  if (!(await isRemoteDebtSyncEnabled())) return;
  outboxProcessing = true;
  try {
    const rows = await all(
      `SELECT id, op_type, client_id, payload_json, attempts, next_retry_at
       FROM debt_sync_outbox
       WHERE done = 0 AND next_retry_at <= ?
       ORDER BY id ASC
       LIMIT ?`,
      [nowIso(), Math.max(1, Number(limit || 20))]
    );
    for (const row of rows) {
      try {
        await processOneOutboxRow(row);
        await run(
          "UPDATE debt_sync_outbox SET done = 1, attempts = attempts + 1, last_error = '', updated_at = ? WHERE id = ?",
          [nowIso(), row.id]
        );
      } catch (err) {
        const attempts = Number(row.attempts || 0) + 1;
        await run(
          "UPDATE debt_sync_outbox SET attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
          [
            attempts,
            nextRetryIso(attempts),
            String(err.message || "Ошибка синхронизации").slice(0, 500),
            nowIso(),
            row.id
          ]
        );
      }
    }
  } finally {
    outboxProcessing = false;
  }
}

async function ensureRemoteDebtorForClient(client, options = {}) {
  const createIfMissing = Boolean(options.createIfMissing);
  const createAmount = Number(options.createAmount || 0);
  const createComment = String(options.createComment || "").trim();
  const clientId = Number(client?.id || 0);
  if (!clientId) throw new Error("Некорректный clientId для синхронизации");
  const name = normalizeClientName(client?.name);
  const phone = normalizeClientPhone(client?.phone || "");
  let remoteId = normalizeRemoteDebtorId(client?.externalDebtorId || client?.external_debtor_id);

  if (!remoteId) {
    remoteId = await resolveRemoteDebtorIdByNamePhone(name, phone);
  }

  let createdNow = false;
  if (!remoteId && createIfMissing) {
    if (!Number.isFinite(createAmount) || createAmount <= 0) {
      throw new Error("Нужна сумма для создания remote должника");
    }
    const created = await remoteDebtApi("/api/debts", {
      method: "POST",
      body: JSON.stringify({
        name,
        phone,
        amount: Number(createAmount.toFixed(2)),
        comment: createComment.slice(0, 240)
      })
    });
    remoteId = normalizeRemoteDebtorId(created?.id);
    if (!remoteId) {
      remoteId = await resolveRemoteDebtorIdByNamePhone(name, phone);
    }
    if (!remoteId) {
      throw new Error("Не удалось получить remote debtor id после создания");
    }
    createdNow = true;
  }

  if (!remoteId) {
    throw new Error("Remote должник не найден");
  }
  await run("UPDATE clients SET external_debtor_id = ? WHERE id = ?", [remoteId, clientId]);
  return { remoteId, createdNow };
}

async function syncLocalDebtSaleToRemote(client, sale) {
  if (!(await isRemoteDebtSyncEnabled())) return;
  const amount = Number(sale?.debtTotal ?? sale?.total ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const comment = String(sale?.comment || "").trim();
  const saleMarker = `[KASSA_SALE:${sale?.id || "-"}]`;
  const note = comment
    ? `${comment} | Чек ${sale?.id || "-"} ${saleMarker}`
    : `Чек ${sale?.id || "-"} ${saleMarker}`;
  const { remoteId, createdNow } = await ensureRemoteDebtorForClient(client, {
    createIfMissing: true,
    createAmount: amount,
    createComment: note
  });
  if (createdNow) {
    const createdRecordId = await findRemoteRecordIdForMarker(remoteId, "debt", amount, saleMarker);
    if (createdRecordId) {
      await run(
        "INSERT OR IGNORE INTO debt_sync_records (remote_record_id, remote_debtor_id, client_id, record_type, local_sale_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
        [`${remoteId}:${createdRecordId}`, remoteId, Number(client.id), "debt", Number(sale.dbId || 0) || null, new Date().toISOString()]
      );
    }
  } else {
    await remoteDebtApi(`/api/debts/${encodeURIComponent(remoteId)}/add-debt`, {
      method: "POST",
      body: JSON.stringify({ amount: Number(amount.toFixed(2)), comment: note.slice(0, 240) })
    });
    const createdRecordId = await findRemoteRecordIdForMarker(remoteId, "debt", amount, saleMarker);
    if (createdRecordId) {
      await run(
        "INSERT OR IGNORE INTO debt_sync_records (remote_record_id, remote_debtor_id, client_id, record_type, local_sale_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
        [`${remoteId}:${createdRecordId}`, remoteId, Number(client.id), "debt", Number(sale.dbId || 0) || null, new Date().toISOString()]
      );
    }
  }
}

async function syncLocalDebtPaymentToRemote(client, payment) {
  if (!(await isRemoteDebtSyncEnabled())) return;
  const { remoteId } = await ensureRemoteDebtorForClient(client, { createIfMissing: false });
  const amount = Number(payment?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const paymentMarker = `[KASSA_PAY:${payment?.id || "-"}]`;
  const rawComment = String(payment?.comment || "").trim();
  const comment = rawComment ? `${rawComment} ${paymentMarker}` : paymentMarker;
  await remoteDebtApi(`/api/debts/${encodeURIComponent(remoteId)}/pay`, {
    method: "POST",
    body: JSON.stringify({ amount: Number(amount.toFixed(2)), comment: comment.slice(0, 240) })
  });
  const createdRecordId = await findRemoteRecordIdForMarker(remoteId, "payment", amount, paymentMarker);
  if (createdRecordId) {
    await run(
      "INSERT OR IGNORE INTO debt_sync_records (remote_record_id, remote_debtor_id, client_id, record_type, local_payment_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
      [`${remoteId}:${createdRecordId}`, remoteId, Number(client.id), "payment", Number(payment.id || 0) || null, new Date().toISOString()]
    );
  }
}

async function getClientDebtSnapshot(clientId) {
  const client = await get(
    "SELECT id, name, phone, note, external_debtor_id as externalDebtorId, created_at as createdAt FROM clients WHERE id = ?",
    [clientId]
  );
  if (!client) throw new Error("Клиент не найден");

  const soldRow = await get(
    "SELECT COALESCE(SUM(debt_total), 0) as debtSold FROM sales WHERE payment_type = 'debt' AND client_id = ?",
    [clientId]
  );
  const paidRow = await get(
    "SELECT COALESCE(SUM(amount), 0) as debtPaid FROM debt_payments WHERE client_id = ?",
    [clientId]
  );
  const salesTotalRow = await get(
    "SELECT COALESCE(SUM(total), 0) as totalAmount FROM sales WHERE client_id = ?",
    [clientId]
  );
  const byPaymentRows = await all(
    "SELECT payment_type as paymentType, COALESCE(SUM(total), 0) as total FROM sales WHERE client_id = ? GROUP BY payment_type",
    [clientId]
  );
  const itemsTotalRow = await get(
    `SELECT COALESCE(SUM(si.qty), 0) as qtyTotal, COALESCE(SUM(si.qty * si.price), 0) as amountTotal
     FROM sale_items si
     INNER JOIN sales s ON s.id = si.sale_id
     WHERE s.client_id = ?`,
    [clientId]
  );
  const debtSales = await all(
    `SELECT id as dbId, sale_code as id, created_at as createdAt, total, debt_total as debtTotal, comment,
            is_return as isReturn, return_of_sale_id as returnOfSaleId
     FROM sales
     WHERE payment_type = 'debt' AND client_id = ?
     ORDER BY id DESC`,
    [clientId]
  );
  const paidBySaleRows = await all(
    `SELECT sale_id as saleId, COALESCE(SUM(amount), 0) as paidTotal
     FROM debt_payments
     WHERE client_id = ? AND sale_id IS NOT NULL
     GROUP BY sale_id`,
    [clientId]
  );
  const unlinkedPaidRow = await get(
    "SELECT COALESCE(SUM(amount), 0) as paidTotal FROM debt_payments WHERE client_id = ? AND sale_id IS NULL",
    [clientId]
  );
  const paidBySale = new Map(
    paidBySaleRows.map((row) => [Number(row.saleId), Number(row.paidTotal || 0)])
  );
  let unlinkedRemaining = Number(unlinkedPaidRow?.paidTotal || 0);
  const payments = await all(
    `SELECT id, sale_id as saleId, amount, payment_type as paymentType, created_at as createdAt, comment
     FROM debt_payments
     WHERE client_id = ?
     ORDER BY id DESC`,
    [clientId]
  );

  const debtSold = Number(soldRow?.debtSold || 0);
  const debtPaid = Number(paidRow?.debtPaid || 0);
  const balance = Number((debtSold - debtPaid).toFixed(2));
  const byPayment = byPaymentRows.reduce((acc, row) => {
    acc[row.paymentType] = Number(row.total || 0);
    return acc;
  }, {});

  return {
    client: {
      id: Number(client.id),
      name: client.name,
      phone: client.phone || "",
      note: client.note || "",
      externalDebtorId: client.externalDebtorId || "",
      createdAt: client.createdAt
    },
    debtSold,
    debtPaid,
    balance,
    totalAmount: Number(salesTotalRow?.totalAmount || 0),
    itemsQty: Number(itemsTotalRow?.qtyTotal || 0),
    itemsAmount: Number(itemsTotalRow?.amountTotal || 0),
    byPayment,
    sales: debtSales
      .map((row) => ({
        dbId: Number(row.dbId),
        id: row.id,
        createdAt: row.createdAt,
        total: Number(row.total || 0),
        debtTotal: Number(row.debtTotal || 0),
        comment: row.comment || "",
        isReturn: Number(row.isReturn || 0) === 1,
        returnOfSaleId: row.returnOfSaleId ? Number(row.returnOfSaleId) : null
      }))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((sale) => {
        const linkedPaid = Number(paidBySale.get(Number(sale.dbId)) || 0);
        const remaining = Math.max(0, Number(sale.debtTotal || 0) - linkedPaid);
        const allocated = Math.min(remaining, Math.max(0, unlinkedRemaining));
        unlinkedRemaining = Number((unlinkedRemaining - allocated).toFixed(2));
        const paidTotal = Number((linkedPaid + allocated).toFixed(2));
        const debtTotal = Number(sale.debtTotal || 0);
        const status = debtTotal > 0 && paidTotal >= debtTotal ? "paid" : paidTotal > 0 ? "partial" : "unpaid";
        return {
          ...sale,
          debtPaidTotal: paidTotal,
          debtStatus: status
        };
      }),
    payments: payments.map((row) => ({
      id: Number(row.id),
      saleId: row.saleId ? Number(row.saleId) : null,
      amount: Number(row.amount || 0),
      paymentType: row.paymentType || "cash",
      createdAt: row.createdAt,
      comment: row.comment || ""
    }))
  };
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL DEFAULT 'шт',
      price REAL NOT NULL,
      min_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY,
      is_open INTEGER NOT NULL,
      opened_at TEXT,
      closed_at TEXT,
      cashier TEXT
    )
  `);

    await run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_code TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        cashier TEXT NOT NULL,
        payment_type TEXT NOT NULL,
        total REAL NOT NULL,
        comment TEXT,
        client_id INTEGER,
        debt_total REAL NOT NULL DEFAULT 0,
        is_return INTEGER NOT NULL DEFAULT 0,
        return_of_sale_id INTEGER
      )
    `);

  await run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      note TEXT,
      external_debtor_id TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      price REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS z_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      sales_count INTEGER NOT NULL,
      revenue REAL NOT NULL,
      cash_total REAL NOT NULL,
      card_total REAL NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventory_ops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      operation TEXT NOT NULL,
      qty_delta INTEGER NOT NULL DEFAULT 0,
      old_price REAL,
      new_price REAL,
      comment TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      sale_id INTEGER,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      comment TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS stock_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      cashier TEXT,
      comment TEXT,
      total_cost REAL NOT NULL DEFAULT 0,
      total_retail REAL NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS stock_receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      product_id TEXT,
      sku TEXT,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      cost_price REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      min_price REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS debt_sync_records (
      remote_record_id TEXT PRIMARY KEY,
      remote_debtor_id TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      record_type TEXT NOT NULL,
      local_sale_id INTEGER,
      local_payment_id INTEGER,
      imported_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (local_sale_id) REFERENCES sales(id),
      FOREIGN KEY (local_payment_id) REFERENCES debt_payments(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS debt_sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_type TEXT NOT NULL,
      client_id INTEGER,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL,
      last_error TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `);

  await ensureDefaultSetting("printer.transport", DEFAULT_PRINT_CONFIG.transport);
  await ensureDefaultSetting("printer.host", DEFAULT_PRINT_CONFIG.host);
  await ensureDefaultSetting("printer.port", DEFAULT_PRINT_CONFIG.port);
  await ensureDefaultSetting("printer.comPort", DEFAULT_PRINT_CONFIG.comPort);
  await ensureDefaultSetting("printer.comBaudRate", DEFAULT_PRINT_CONFIG.comBaudRate);
  await ensureDefaultSetting("printer.charsPerLine", DEFAULT_PRINT_CONFIG.charsPerLine);
  await ensureDefaultSetting("printer.codePage", DEFAULT_PRINT_CONFIG.codePage);
  await ensureDefaultSetting("reports.lastZAt", "1970-01-01T00:00:00.000Z");
  await ensureDefaultSetting("sales.nextNumber", "100");
  await ensureDefaultSetting("stock.nextNumber", "1");
  await ensureDefaultSetting("debt.adminPin", "1234");
  await ensureDefaultSetting("debt.remoteBaseUrl", DEFAULT_REMOTE_DEBT_BASE_URL);
  await ensureDefaultSetting("debt.remoteSyncEnabled", "1");
  await ensureCategoryExists("Без категории");

  const productColumns = await all("PRAGMA table_info(products)");
  const hasProductUnit = productColumns.some((c) => c.name === "unit");
  if (!hasProductUnit) {
    await run("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'шт'");
  }
  const hasProductMinPrice = productColumns.some((c) => c.name === "min_price");
  if (!hasProductMinPrice) {
    await run("ALTER TABLE products ADD COLUMN min_price REAL NOT NULL DEFAULT 0");
  }
  await run("UPDATE products SET unit = 'шт' WHERE unit IS NULL OR TRIM(unit) = ''");
  await run(
    "UPDATE products SET min_price = price WHERE min_price IS NULL OR CAST(min_price AS REAL) <= 0"
  );
  await run("UPDATE products SET min_price = price WHERE min_price > price");

  const saleItemColumns = await all("PRAGMA table_info(sale_items)");
  const hasSaleItemUnit = saleItemColumns.some((c) => c.name === "unit");
  if (!hasSaleItemUnit) {
    await run("ALTER TABLE sale_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'шт'");
  }
  await run("UPDATE sale_items SET unit = 'шт' WHERE unit IS NULL OR TRIM(unit) = ''");

  const receiptItemColumns = await all("PRAGMA table_info(stock_receipt_items)");
  const hasReceiptItemMinPrice = receiptItemColumns.some((c) => c.name === "min_price");
  if (!hasReceiptItemMinPrice) {
    await run("ALTER TABLE stock_receipt_items ADD COLUMN min_price REAL NOT NULL DEFAULT 0");
  }

  const salesColumns = await all("PRAGMA table_info(sales)");
  const hasSalesComment = salesColumns.some((c) => c.name === "comment");
  if (!hasSalesComment) {
    await run("ALTER TABLE sales ADD COLUMN comment TEXT");
  }
  const hasSalesClientId = salesColumns.some((c) => c.name === "client_id");
  if (!hasSalesClientId) {
    await run("ALTER TABLE sales ADD COLUMN client_id INTEGER");
  }
  const hasSalesDebtTotal = salesColumns.some((c) => c.name === "debt_total");
  if (!hasSalesDebtTotal) {
    await run("ALTER TABLE sales ADD COLUMN debt_total REAL NOT NULL DEFAULT 0");
  }
  const hasSalesIsReturn = salesColumns.some((c) => c.name === "is_return");
  if (!hasSalesIsReturn) {
    await run("ALTER TABLE sales ADD COLUMN is_return INTEGER NOT NULL DEFAULT 0");
  }
  const hasSalesReturnOf = salesColumns.some((c) => c.name === "return_of_sale_id");
  if (!hasSalesReturnOf) {
    await run("ALTER TABLE sales ADD COLUMN return_of_sale_id INTEGER");
  }

  const clientColumns = await all("PRAGMA table_info(clients)");
  const hasExternalDebtorId = clientColumns.some((c) => c.name === "external_debtor_id");
  if (!hasExternalDebtorId) {
    await run("ALTER TABLE clients ADD COLUMN external_debtor_id TEXT");
  }
  await run("UPDATE sales SET debt_total = 0 WHERE debt_total IS NULL");
  await run("UPDATE sales SET is_return = 0 WHERE is_return IS NULL");

  const shiftCount = await get("SELECT COUNT(*) as count FROM shifts");
  if (shiftCount.count === 0) {
    await run(
      "INSERT INTO shifts (id, is_open, opened_at, closed_at, cashier) VALUES (1, 1, ?, NULL, ?)",
      [new Date().toISOString(), "Кассир 1"]
    );
  }

  const existingCategories = await all(
    "SELECT DISTINCT TRIM(category) as category FROM products WHERE category IS NOT NULL AND TRIM(category) <> ''"
  );
  for (const row of existingCategories) {
    await run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [row.category]);
  }
  await run("UPDATE products SET category = 'Без категории' WHERE category IS NULL OR TRIM(category) = ''");
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), db: DB_PATH });
});

app.get("/api/print/config", async (req, res) => {
  try {
    const config = await getPrintConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: "Ошибка чтения настроек принтера" });
  }
});

app.post("/api/print/config", async (req, res) => {
  try {
    const incoming = {
      transport: req.body.transport,
      host: req.body.host,
      port: req.body.port !== undefined ? Number(req.body.port) : undefined,
      comPort: req.body.comPort,
      comBaudRate: req.body.comBaudRate !== undefined ? Number(req.body.comBaudRate) : undefined,
      charsPerLine: req.body.charsPerLine !== undefined ? Number(req.body.charsPerLine) : undefined,
      codePage: req.body.codePage !== undefined ? Number(req.body.codePage) : undefined
    };
    const config = await savePrintConfig(incoming);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка сохранения настроек принтера" });
  }
});

app.post("/api/print/receipt", async (req, res) => {
  try {
    const sale = normalizeSalePayload(req.body);
    const config = await getPrintConfig();
    const payload = buildEscPosReceipt(sale, config);
    await sendToPrinter(payload, config);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка печати чека" });
  }
});

function sanitizeFileName(value) {
  const base = String(value || "Чек")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ");
  return base || "Чек";
}

async function ensureUniquePath(dir, baseName) {
  let name = baseName;
  let attempt = 1;
  let target = path.join(dir, `${name}.jpeg`);
  while (fs.existsSync(target)) {
    attempt += 1;
    target = path.join(dir, `${name}_${attempt}.jpeg`);
  }
  return target;
}

app.post("/api/receipt/save-jpeg", async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || "");
    if (!dataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "Неверный формат изображения" });
    }
    const base64 = dataUrl.split(",")[1] || "";
    if (!base64) {
      return res.status(400).json({ error: "Пустое изображение" });
    }

    const desktopDir = path.join(os.homedir(), "Desktop", "Чек");
    await fs.promises.mkdir(desktopDir, { recursive: true });
    const safeName = sanitizeFileName(req.body?.fileName || "Чек");
    const targetPath = await ensureUniquePath(desktopDir, safeName);

    const buffer = Buffer.from(base64, "base64");
    await fs.promises.writeFile(targetPath, buffer);

    res.json({ ok: true, path: targetPath, fileName: path.basename(targetPath) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Не удалось сохранить JPEG" });
  }
});

app.post("/api/print/report", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const headerLines = Array.isArray(req.body?.headerLines) ? req.body.headerLines : [];
    const bodyLines = Array.isArray(req.body?.bodyLines) ? req.body.bodyLines : [];

    if (!title || bodyLines.length === 0) {
      return res.status(400).json({ error: "Нет данных отчета для печати" });
    }

    const config = await getPrintConfig();
    const payload = buildEscPosReport({ title, headerLines, bodyLines }, config);
    await sendToPrinter(payload, config);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка печати отчета" });
  }
});

app.post("/api/print/test", async (req, res) => {
  try {
    const config = await getPrintConfig();
    const testSale = {
      id: `TEST-${Date.now()}`,
      createdAt: new Date().toISOString(),
      cashier: "Тест",
      paymentType: "cash",
      total: 1,
      items: [{ name: "Тестовая позиция", qty: 1, price: 1 }]
    };
    const payload = buildEscPosReceipt(testSale, config);
    await sendToPrinter(payload, config);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка печати чека" });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const products = await all(
      "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products ORDER BY name ASC"
    );
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки товаров" });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const categories = await all(
      `SELECT c.id, c.name, COUNT(p.id) as productsCount
       FROM categories c
       LEFT JOIN products p ON p.category = c.name
       GROUP BY c.id, c.name
       ORDER BY c.name COLLATE NOCASE ASC`
    );
    res.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        productsCount: Number(c.productsCount || 0)
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки категорий" });
  }
});

app.post("/api/categories", async (req, res) => {
  try {
    const name = normalizeCategoryName(req.body?.name);
    const existing = await get("SELECT id FROM categories WHERE name = ?", [name]);
    if (existing) {
      return res.status(400).json({ error: "Категория уже существует" });
    }
    const result = await run("INSERT INTO categories (name) VALUES (?)", [name]);
    res.status(201).json({ id: result.lastID, name, productsCount: 0 });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка создания категории" });
  }
});

app.patch("/api/categories/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Неверный id категории" });
    }
    const category = await get("SELECT id, name FROM categories WHERE id = ?", [id]);
    if (!category) {
      return res.status(404).json({ error: "Категория не найдена" });
    }

    const newName = normalizeCategoryName(req.body?.name);
    if (newName === category.name) {
      return res.json({ id, name: newName });
    }
    const duplicate = await get("SELECT id FROM categories WHERE name = ? AND id <> ?", [
      newName,
      id
    ]);
    if (duplicate) {
      return res.status(400).json({ error: "Категория с таким названием уже есть" });
    }

    await run("BEGIN IMMEDIATE TRANSACTION");
    await run("UPDATE categories SET name = ? WHERE id = ?", [newName, id]);
    await run("UPDATE products SET category = ? WHERE category = ?", [newName, category.name]);
    await run("COMMIT");

    res.json({ id, name: newName });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    res.status(400).json({ error: err.message || "Ошибка переименования категории" });
  }
});

app.delete("/api/categories/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Неверный id категории" });
    }
    const category = await get("SELECT id, name FROM categories WHERE id = ?", [id]);
    if (!category) {
      return res.status(404).json({ error: "Категория не найдена" });
    }

    const inUse = await get("SELECT COUNT(*) as count FROM products WHERE category = ?", [category.name]);
    if (Number(inUse?.count || 0) > 0) {
      const targetId = Number(req.body?.targetCategoryId);
      if (!Number.isInteger(targetId) || targetId <= 0 || targetId === id) {
        return res.status(400).json({ error: "Выберите категорию, куда перенести товары" });
      }
      const target = await get("SELECT id, name FROM categories WHERE id = ?", [targetId]);
      if (!target) {
        return res.status(400).json({ error: "Категория переноса не найдена" });
      }

      await run("BEGIN IMMEDIATE TRANSACTION");
      await run("UPDATE products SET category = ? WHERE category = ?", [target.name, category.name]);
      await run("DELETE FROM categories WHERE id = ?", [id]);
      await run("COMMIT");
      return res.json({ ok: true, movedTo: target.name });
    }

    await run("DELETE FROM categories WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    res.status(400).json({ error: err.message || "Ошибка удаления категории" });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const data = normalizeProductPayload(req.body);
    data.category = await ensureCategoryExists(data.category);
    const existing = await get("SELECT id FROM products WHERE sku = ?", [data.sku]);
    if (existing) {
      return res.status(400).json({ error: "Товар с таким кодом уже существует" });
    }

    const id = makeProductId();
    await run(
      "INSERT INTO products (id, sku, name, category, unit, price, min_price, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.sku, data.name, data.category, data.unit, data.price, data.minPrice, data.stock]
    );
    await run(
      "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, new_price, comment) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [new Date().toISOString(), id, data.sku, "create", data.stock, data.price, "Создание товара"]
    );

    res.status(201).json({ id, ...data });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка добавления товара" });
  }
});

app.get("/api/products/template", (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const rows = [
      {
        "Название": "Новый товар",
        "Категория": "Без категории",
        "ЕдИзм": "шт",
        "Цена": 99.9,
        "Мин. цена": 90
      }
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Товары");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="products_template.xlsx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: "Не удалось сформировать шаблон" });
  }
});

app.post("/api/products/import", upload.single("file"), async (req, res) => {
  if (!req.file?.path) {
    return res.status(400).json({ error: "Файл не передан" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const rows = parseImportRowsFromWorkbook(workbook);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "Файл пустой или без данных" });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const autoSku = `AUTO-${Date.now()}-${i + 1}`;
      const raw = {
        sku:
          row.SKU ??
          row.sku ??
          row["Артикул"] ??
          row["Код"] ??
          row["Код товара"] ??
          autoSku,
        name: row["Название"] ?? row.Name ?? row.name ?? row["Наименование"] ?? "",
        category: row["Категория"] ?? row.Category ?? row.category ?? "Без категории",
        unit: row["Ед"] ?? row["Ед.изм"] ?? row["ЕдИзм"] ?? row["Единица"] ?? row.Unit ?? row.unit ?? "шт",
        price: row["Цена"] ?? row.Price ?? row.price ?? "",
        minPrice:
          row["Мин. цена"] ??
          row["МинЦена"] ??
          row["Минимальная цена"] ??
          row.MinPrice ??
          row.minPrice ??
          row.min_price ??
          "",
        stock: row["Остаток"] ?? row.Stock ?? row.stock ?? 0
      };

      try {
        const product = normalizeProductPayload(raw);
        product.category = await ensureCategoryExists(product.category);
        const existing = await get(
          "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
          [product.name]
        );

        if (existing) {
          const oldPrice = Number(existing.price || 0);
          const oldMinPrice = Number(existing.minPrice || 0);
          if (Number(product.price) !== oldPrice || Number(product.minPrice) !== oldMinPrice) {
            await run(
              "UPDATE products SET price = ?, min_price = ?, unit = ? WHERE id = ?",
              [product.price, product.minPrice, product.unit, existing.id]
            );
            await run(
              "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, old_price, new_price, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [
                new Date().toISOString(),
                existing.id,
                existing.sku,
                "import_update",
                0,
                oldPrice,
                product.price,
                "Импорт из Excel: обновление цены/мин. цены по названию"
              ]
            );
            updated += 1;
          } else {
            skipped += 1;
          }
        } else {
          const id = makeProductId();
          await run(
            "INSERT INTO products (id, sku, name, category, unit, price, min_price, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [id, product.sku, product.name, product.category, product.unit, product.price, product.minPrice, product.stock]
          );
          await run(
            "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, new_price, comment) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [new Date().toISOString(), id, product.sku, "import_create", product.stock, product.price, "Импорт из Excel"]
          );
          created += 1;
        }
      } catch (err) {
        errors.push(`Строка ${i + 2}: ${err.message}`);
      }
    }

    res.json({ ok: true, created, updated, skipped, errors });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка импорта Excel" });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

app.post("/api/products/:id/writeoff", async (req, res) => {
  const qty = Number(req.body?.qty);
  const comment = String(req.body?.comment || "").trim();

  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: "Количество списания должно быть целым числом больше 0" });
  }

  try {
    const product = await get(
      "SELECT id, sku, stock FROM products WHERE id = ?",
      [req.params.id]
    );
    if (!product) {
      return res.status(404).json({ error: "Товар не найден" });
    }
    if (Number(product.stock) < qty) {
      return res.status(400).json({ error: "Недостаточно остатка для списания" });
    }

    await run("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, product.id]);
    await run(
      "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, comment) VALUES (?, ?, ?, ?, ?, ?)",
      [new Date().toISOString(), product.id, product.sku, "writeoff", -qty, comment || "Списание товара"]
    );

    const updated = await get(
      "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products WHERE id = ?",
      [product.id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Ошибка списания товара" });
  }
});

app.post("/api/products/:id/reprice", async (req, res) => {
  const price = Number(req.body?.price);
  const comment = String(req.body?.comment || "").trim();

  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Новая цена должна быть больше 0" });
  }

  try {
    const product = await get(
      "SELECT id, sku, price FROM products WHERE id = ?",
      [req.params.id]
    );
    if (!product) {
      return res.status(404).json({ error: "Товар не найден" });
    }

    const nextPrice = Number(price.toFixed(2));
    await run("UPDATE products SET price = ? WHERE id = ?", [nextPrice, product.id]);
    await run(
      "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, old_price, new_price, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [new Date().toISOString(), product.id, product.sku, "reprice", 0, Number(product.price), nextPrice, comment || "Переоценка товара"]
    );

    const updated = await get(
      "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products WHERE id = ?",
      [product.id]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Ошибка переоценки товара" });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const productId = String(req.params.id || "").trim();
    const existing = await get(
      "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products WHERE id = ?",
      [productId]
    );
    if (!existing) {
      return res.status(404).json({ error: "Товар не найден" });
    }

    const name = String(req.body?.name || "").trim();
    const category = String(req.body?.category || "").trim();
    const unit = normalizeUnit(req.body?.unit);
    const price = Number(req.body?.price);
    const minPriceRaw = req.body?.minPrice ?? req.body?.min_price;
    const minPrice =
      minPriceRaw === undefined || minPriceRaw === null || String(minPriceRaw).trim() === ""
        ? price
        : Number(minPriceRaw);

    if (!name) return res.status(400).json({ error: "Название товара обязательно" });
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Цена должна быть больше 0" });
    }
    if (!Number.isFinite(minPrice) || minPrice <= 0) {
      return res.status(400).json({ error: "Мин. цена должна быть больше 0" });
    }
    if (minPrice > price) {
      return res.status(400).json({ error: "Мин. цена не может быть больше цены" });
    }
    const normalizedCategory = await ensureCategoryExists(category || "Без категории");
    const sku = existing.sku;

    await run(
      "UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, price = ?, min_price = ? WHERE id = ?",
      [sku, name, normalizedCategory, unit, Number(price.toFixed(2)), Number(minPrice.toFixed(2)), productId]
    );

    await run(
      "INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, old_price, new_price, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        new Date().toISOString(),
        productId,
        sku,
        "edit",
        0,
        Number(existing.price || 0),
        Number(price.toFixed(2)),
        "Редактирование товара"
      ]
    );

    const updated = await get(
      "SELECT id, sku, name, category, unit, price, min_price as minPrice, stock FROM products WHERE id = ?",
      [productId]
    );
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка обновления товара" });
  }
});

app.get("/api/clients", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const search = String(req.query.search || "").trim().toLowerCase();
    const params = [];
    let where = "";
    if (search) {
      where = "WHERE LOWER(name) LIKE ? OR LOWER(COALESCE(phone, '')) LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }

    const rows = await all(
      `SELECT id, name, phone, note, external_debtor_id as externalDebtorId, created_at as createdAt
       FROM clients
       ${where}
       ORDER BY name ASC
       LIMIT ?`,
      [...params, limit]
    );

    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        phone: row.phone || "",
        note: row.note || "",
        externalDebtorId: row.externalDebtorId || "",
        createdAt: row.createdAt
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки клиентов" });
  }
});

app.post("/api/clients", async (req, res) => {
  try {
    const name = normalizeClientName(req.body?.name);
    const phone = normalizeClientPhone(req.body?.phone);
    const note = normalizeClientNote(req.body?.note);
    const externalDebtorId = normalizeRemoteDebtorId(req.body?.externalDebtorId);
    const createdAt = new Date().toISOString();

    const created = await run(
      "INSERT INTO clients (name, phone, note, external_debtor_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [name, phone, note, externalDebtorId || null, createdAt]
    );

    res.status(201).json({
      id: Number(created.lastID),
      name,
      phone,
      note,
      externalDebtorId,
      createdAt
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка создания клиента" });
  }
});

app.post("/api/clients/:id/sync-remote-link", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }
    const client = await get(
      "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
      [clientId]
    );
    if (!client) {
      return res.status(404).json({ error: "Клиент не найден" });
    }
    const { remoteId: remoteDebtorId } = await ensureRemoteDebtorForClient(client, {
      createIfMissing: false
    });
    return res.json({ ok: true, clientId, remoteDebtorId });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Ошибка связки клиента" });
  }
});

app.post("/api/debts/clients/:id/resync", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }
    const providedPin = String(
      req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
    ).trim();
    const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
    if (!providedPin || providedPin !== expectedPin) {
      return res.status(403).json({ error: "Нужны права администратора" });
    }
    const client = await get(
      "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
      [clientId]
    );
    if (!client) {
      return res.status(404).json({ error: "Клиент не найден" });
    }

    await run("UPDATE clients SET external_debtor_id = NULL WHERE id = ?", [clientId]);
    await run("DELETE FROM debt_sync_records WHERE client_id = ?", [clientId]);

    const missingSales = await all(
      `SELECT s.id as saleId, s.sale_code as saleCode, s.total, s.debt_total as debtTotal,
              s.comment, s.created_at as createdAt
       FROM sales s
       WHERE s.payment_type = 'debt' AND s.client_id = ?
       ORDER BY s.created_at ASC`,
      [clientId]
    );
    const missingPayments = await all(
      `SELECT dp.id as paymentId, dp.amount, dp.payment_type as paymentType, dp.comment,
              dp.created_at as createdAt
       FROM debt_payments dp
       WHERE dp.client_id = ?
       ORDER BY dp.created_at ASC`,
      [clientId]
    );

    let enqueuedSales = 0;
    for (const sale of missingSales) {
      await enqueueRemoteSyncOp("sale_add", clientId, {
        sale: {
          dbId: Number(sale.saleId),
          id: sale.saleCode,
          total: Number(sale.total || 0),
          debtTotal: Number(sale.debtTotal || 0),
          comment: sale.comment || "",
          createdAt: sale.createdAt
        }
      });
      enqueuedSales += 1;
    }

    let enqueuedPayments = 0;
    for (const payment of missingPayments) {
      await enqueueRemoteSyncOp("payment_add", clientId, {
        payment: {
          id: Number(payment.paymentId),
          amount: Number(payment.amount || 0),
          comment: payment.comment || "",
          createdAt: payment.createdAt,
          paymentType: payment.paymentType || "cash"
        }
      });
      enqueuedPayments += 1;
    }

    return res.json({ ok: true, enqueuedSales, enqueuedPayments });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Ошибка пересоздания клиента" });
  }
});

app.get("/api/debts/clients", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const onlyWithDebt = String(req.query.onlyWithDebt || "1") !== "0";
    const params = [];
    let where = "";
    if (search) {
      where = "WHERE LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.phone, '')) LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }

    const rows = await all(
      `SELECT
         c.id,
         c.name,
         c.phone,
         c.note,
         c.external_debtor_id as externalDebtorId,
         c.created_at as createdAt,
         COALESCE((
           SELECT SUM(s.debt_total)
           FROM sales s
           WHERE s.payment_type = 'debt' AND s.client_id = c.id
         ), 0) as debtSold,
         COALESCE((
           SELECT SUM(dp.amount)
           FROM debt_payments dp
           WHERE dp.client_id = c.id
         ), 0) as debtPaid
       FROM clients c
       ${where}
       ORDER BY c.name ASC`,
      params
    );

    const result = rows
      .map((row) => {
        const debtSold = Number(row.debtSold || 0);
        const debtPaid = Number(row.debtPaid || 0);
        const balance = Number((debtSold - debtPaid).toFixed(2));
        return {
          id: Number(row.id),
          name: row.name,
          phone: row.phone || "",
          note: row.note || "",
          externalDebtorId: row.externalDebtorId || "",
          createdAt: row.createdAt,
          debtSold,
          debtPaid,
          balance
        };
      })
      .filter((row) => (onlyWithDebt ? row.balance > 0 : true));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки должников" });
  }
});

app.get("/api/debts/sync/config", async (req, res) => {
  try {
    const remoteBaseUrl = await getRemoteDebtBaseUrl();
    const enabled = await isRemoteDebtSyncEnabled();
    res.json({ enabled, remoteBaseUrl });
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки настроек синхронизации" });
  }
});

app.post("/api/debts/sync/config", async (req, res) => {
  try {
    const enabled =
      req.body?.enabled === undefined
        ? await isRemoteDebtSyncEnabled()
        : Boolean(req.body.enabled);
    const remoteBaseUrl =
      req.body?.remoteBaseUrl === undefined
        ? await getRemoteDebtBaseUrl()
        : normalizeRemoteBaseUrl(req.body.remoteBaseUrl);

    await setSetting("debt.remoteSyncEnabled", enabled ? "1" : "0");
    await setSetting("debt.remoteBaseUrl", remoteBaseUrl);
    res.json({ enabled, remoteBaseUrl });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка сохранения настроек синхронизации" });
  }
});

app.get("/api/debts/sync/outbox", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const rows = await all(
      `SELECT id, op_type as opType, client_id as clientId, attempts, next_retry_at as nextRetryAt,
              last_error as lastError, done, created_at as createdAt, updated_at as updatedAt
       FROM debt_sync_outbox
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(
      rows.map((r) => ({
        id: Number(r.id),
        opType: r.opType,
        clientId: r.clientId ? Number(r.clientId) : null,
        attempts: Number(r.attempts || 0),
        nextRetryAt: r.nextRetryAt,
        lastError: r.lastError || "",
        done: Boolean(r.done),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки очереди синхронизации" });
  }
});

app.post("/api/debts/sync/outbox/retry", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit || 50), 1), 500);
    await run("UPDATE debt_sync_outbox SET next_retry_at = ?, updated_at = ? WHERE done = 0", [
      nowIso(),
      nowIso()
    ]);
    await processRemoteSyncOutbox(limit);
    const pending = await get("SELECT COUNT(*) as c FROM debt_sync_outbox WHERE done = 0");
    const failed = await get(
      "SELECT COUNT(*) as c FROM debt_sync_outbox WHERE done = 0 AND COALESCE(last_error, '') <> ''"
    );
    res.json({
      ok: true,
      pending: Number(pending.c || 0),
      failed: Number(failed.c || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Ошибка повторной синхронизации" });
  }
});

app.post("/api/debts/sync/reconcile", async (req, res) => {
  try {
    if (!(await isRemoteDebtSyncEnabled())) {
      return res.json({ ok: true, enqueuedSales: 0, enqueuedPayments: 0, skipped: true });
    }

    const missingSales = await all(
      `SELECT s.id as saleId, s.sale_code as saleCode, s.total, s.debt_total as debtTotal,
              s.comment, s.created_at as createdAt, s.client_id as clientId
       FROM sales s
       LEFT JOIN debt_sync_records r
         ON r.local_sale_id = s.id AND r.record_type = 'debt'
       WHERE s.payment_type = 'debt' AND r.remote_record_id IS NULL`
    );

    const missingPayments = await all(
      `SELECT dp.id as paymentId, dp.amount, dp.payment_type as paymentType, dp.comment,
              dp.created_at as createdAt, dp.client_id as clientId
       FROM debt_payments dp
       LEFT JOIN debt_sync_records r
         ON r.local_payment_id = dp.id AND r.record_type = 'payment'
       WHERE r.remote_record_id IS NULL`
    );

    let enqueuedSales = 0;
    for (const sale of missingSales) {
      if (!sale.clientId) continue;
      await enqueueRemoteSyncOp("sale_add", Number(sale.clientId), {
        sale: {
          dbId: Number(sale.saleId),
          id: sale.saleCode,
          total: Number(sale.total || 0),
          debtTotal: Number(sale.debtTotal || 0),
          comment: sale.comment || "",
          createdAt: sale.createdAt
        }
      });
      enqueuedSales += 1;
    }

    let enqueuedPayments = 0;
    for (const payment of missingPayments) {
      if (!payment.clientId) continue;
      await enqueueRemoteSyncOp("payment_add", Number(payment.clientId), {
        payment: {
          id: Number(payment.paymentId),
          amount: Number(payment.amount || 0),
          comment: payment.comment || "",
          createdAt: payment.createdAt,
          paymentType: payment.paymentType || "cash"
        }
      });
      enqueuedPayments += 1;
    }

    res.json({ ok: true, enqueuedSales, enqueuedPayments, skipped: false });
  } catch (err) {
    console.error("[debt-sync] reconcile error:", err);
    res.status(500).json({ error: err.message || "Ошибка сверки синхронизации" });
  }
});

app.post("/api/debts/sync/import-remote", async (req, res) => {
  const importRecords = String(req.body?.importRecords || "1") !== "0";
  try {
    const remoteDebtors = await remoteDebtApi("/api/debts");
    if (!Array.isArray(remoteDebtors)) {
      return res.status(400).json({ error: "Некорректный ответ remote API" });
    }

    let clientsCreated = 0;
    let clientsUpdated = 0;
    let recordsImported = 0;

    await run("BEGIN IMMEDIATE TRANSACTION");

    for (const remoteDebtor of remoteDebtors) {
      const remoteId = normalizeRemoteDebtorId(remoteDebtor?.id);
      const name = normalizeClientName(remoteDebtor?.name || "");
      const phone = normalizeClientPhone(remoteDebtor?.phone || "");
      const note = normalizeClientNote("Импортировано из remote debt-tracker");

      let client = null;
      if (remoteId) {
        client = await get("SELECT id FROM clients WHERE external_debtor_id = ?", [remoteId]);
      }
      if (!client) {
        if (phone) {
          client = await get(
            "SELECT id FROM clients WHERE LOWER(name) = LOWER(?) AND COALESCE(phone, '') = ?",
            [name, phone]
          );
        } else {
          client = await get("SELECT id FROM clients WHERE LOWER(name) = LOWER(?)", [name]);
        }
      }

      let clientId = 0;
      if (!client) {
        const created = await run(
          "INSERT INTO clients (name, phone, note, external_debtor_id, created_at) VALUES (?, ?, ?, ?, ?)",
          [name, phone, note, remoteId || null, new Date().toISOString()]
        );
        clientId = Number(created.lastID);
        clientsCreated += 1;
      } else {
        clientId = Number(client.id);
        await run(
          "UPDATE clients SET name = ?, phone = ?, note = ?, external_debtor_id = COALESCE(?, external_debtor_id) WHERE id = ?",
          [name, phone, note, remoteId || null, clientId]
        );
        clientsUpdated += 1;
      }

      if (!importRecords) continue;
      const records = Array.isArray(remoteDebtor?.debts) ? remoteDebtor.debts : [];
      for (const rec of records) {
        const recId = String(rec?.id || "").trim();
        const type = String(rec?.type || "").trim().toLowerCase();
        const amount = Number(rec?.amount || 0);
        if (!recId || !["debt", "payment"].includes(type)) continue;
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const remoteRecordId = `${remoteId}:${recId}`;
        const existed = await get(
          "SELECT remote_record_id FROM debt_sync_records WHERE remote_record_id = ?",
          [remoteRecordId]
        );
        if (existed) continue;

        const createdAt = normalizeIsoDateOrNow(rec?.date);
        const comment = String(rec?.comment || "").trim().slice(0, 120);

        if (type === "debt") {
          const saleCode = `EXTD-${remoteId}-${recId}`.slice(0, 64);
          let saleRow = await get("SELECT id FROM sales WHERE sale_code = ?", [saleCode]);
          let saleId = saleRow ? Number(saleRow.id) : 0;
          if (!saleId) {
              const createdSale = await run(
                "INSERT INTO sales (sale_code, created_at, cashier, payment_type, total, comment, client_id, debt_total, is_return, return_of_sale_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)",
                [saleCode, createdAt, "Импорт", "debt", Number(amount.toFixed(2)), comment, clientId, Number(amount.toFixed(2))]
              );
            saleId = Number(createdSale.lastID);
          }

          await run(
            "INSERT INTO debt_sync_records (remote_record_id, remote_debtor_id, client_id, record_type, local_sale_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
            [remoteRecordId, remoteId, clientId, "debt", saleId, new Date().toISOString()]
          );
          recordsImported += 1;
        } else {
          const createdPayment = await run(
            "INSERT INTO debt_payments (client_id, sale_id, amount, payment_type, created_at, comment) VALUES (?, ?, ?, ?, ?, ?)",
            [clientId, null, Number(amount.toFixed(2)), "cash", createdAt, comment]
          );
          await run(
            "INSERT INTO debt_sync_records (remote_record_id, remote_debtor_id, client_id, record_type, local_payment_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
            [remoteRecordId, remoteId, clientId, "payment", Number(createdPayment.lastID), new Date().toISOString()]
          );
          recordsImported += 1;
        }
      }
    }

    await run("COMMIT");
    return res.json({
      ok: true,
      remoteCount: remoteDebtors.length,
      clientsCreated,
      clientsUpdated,
      recordsImported
    });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: err.message || "Ошибка импорта из remote debt-tracker" });
  }
});

app.get("/api/clients/:id/debt", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }
    const snapshot = await getClientDebtSnapshot(clientId);
    res.json(snapshot);
  } catch (err) {
    if (String(err.message || "").includes("не найден")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: "Ошибка загрузки долга клиента" });
  }
});

app.post("/api/debts/payments", async (req, res) => {
  try {
    const clientId = Number(req.body?.clientId);
    const amount = Number(req.body?.amount);
    const saleId = req.body?.saleId ? Number(req.body.saleId) : null;
    const paymentType = String(req.body?.paymentType || "cash").trim().toLowerCase();
    const comment = String(req.body?.comment || "").trim().slice(0, 120);

    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Сумма погашения должна быть больше 0" });
    }
    if (!["cash", "card"].includes(paymentType)) {
      return res.status(400).json({ error: "paymentType должен быть cash или card" });
    }

    const snapshot = await getClientDebtSnapshot(clientId);
    const roundedAmount = Number(amount.toFixed(2));
    if (roundedAmount > snapshot.balance) {
      return res.status(400).json({ error: "Сумма погашения больше остатка долга" });
    }

    if (saleId) {
      const sale = await get(
        "SELECT id FROM sales WHERE id = ? AND client_id = ? AND payment_type = 'debt'",
        [saleId, clientId]
      );
      if (!sale) {
        return res.status(400).json({ error: "Чек долга не найден для этого клиента" });
      }
    }

    const createdAt = new Date().toISOString();
    const created = await run(
      "INSERT INTO debt_payments (client_id, sale_id, amount, payment_type, created_at, comment) VALUES (?, ?, ?, ?, ?, ?)",
      [clientId, saleId || null, roundedAmount, paymentType, createdAt, comment]
    );

    let remoteSyncError = "";
    try {
      const client = await get(
        "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
        [clientId]
      );
      if (client) {
        await syncLocalDebtPaymentToRemote(client, {
          id: Number(created.lastID),
          amount: roundedAmount,
          comment,
          createdAt,
          paymentType
        });
      }
    } catch (syncErr) {
      remoteSyncError = String(syncErr.message || "Ошибка синхронизации погашения").slice(0, 220);
      await enqueueRemoteSyncOp(
        "payment_add",
        clientId,
        {
          payment: {
            id: Number(created.lastID),
            amount: roundedAmount,
            comment,
            createdAt,
            paymentType
          }
        },
        remoteSyncError
      );
    }

    res.status(201).json({
      id: Number(created.lastID),
      clientId,
      saleId: saleId || null,
      amount: roundedAmount,
      paymentType,
      createdAt,
      comment,
      remoteSyncError
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Ошибка погашения долга" });
  }
});

app.delete("/api/debts/payments/:paymentId", async (req, res) => {
  try {
    const paymentId = Number(req.params.paymentId || 0);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: "Неверный paymentId" });
    }
    const providedPin = String(
      req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
    ).trim();
    const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
    if (!providedPin || providedPin !== expectedPin) {
      return res.status(403).json({ error: "Нужны права администратора" });
    }

    const payment = await get(
      `SELECT id, client_id as clientId, amount, payment_type as paymentType, comment
       FROM debt_payments
       WHERE id = ?`,
      [paymentId]
    );
    if (!payment) {
      return res.status(404).json({ error: "Погашение не найдено" });
    }

    await run("BEGIN IMMEDIATE TRANSACTION");
    await run("DELETE FROM debt_payments WHERE id = ?", [paymentId]);
    await run("COMMIT");

    let remoteSyncError = "";
    try {
      await enqueueRemoteSyncOp("payment_delete", Number(payment.clientId), {
        paymentId: Number(paymentId)
      });
    } catch (err) {
      remoteSyncError = String(err.message || "Ошибка очереди синхронизации").slice(0, 220);
    }

    return res.json({ ok: true, paymentId: Number(paymentId), remoteSyncError });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: err.message || "Ошибка удаления погашения" });
  }
});

app.delete("/api/clients/:id/debts", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }

    const providedPin = String(
      req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
    ).trim();
    const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
    if (!providedPin || providedPin !== expectedPin) {
      return res.status(403).json({ error: "Нужны права администратора" });
    }

    const client = await get(
      "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
      [clientId]
    );
    if (!client) {
      return res.status(404).json({ error: "Клиент не найден" });
    }

    const snapshot = await getClientDebtSnapshot(clientId);
    const remaining = Number((snapshot.balance || 0).toFixed(2));
    if (remaining <= 0) {
      return res.json({ ok: true, closedAmount: 0, paymentId: null, remoteSyncError: "" });
    }

    const createdAt = new Date().toISOString();
    const comment = "Закрытие долга (операция: Удалить все долги)";

    await run("BEGIN IMMEDIATE TRANSACTION");
    const created = await run(
      "INSERT INTO debt_payments (client_id, sale_id, amount, payment_type, created_at, comment) VALUES (?, ?, ?, ?, ?, ?)",
      [clientId, null, remaining, "cash", createdAt, comment]
    );
    await run("COMMIT");

    let remoteSyncError = "";
    try {
      await syncLocalDebtPaymentToRemote(client, {
        id: Number(created.lastID),
        amount: remaining,
        comment,
        createdAt,
        paymentType: "cash"
      });
    } catch (syncErr) {
      remoteSyncError = String(syncErr.message || "Ошибка синхронизации закрытия долга").slice(0, 220);
      await enqueueRemoteSyncOp(
        "payment_add",
        Number(clientId),
        {
          payment: {
            id: Number(created.lastID),
            amount: remaining,
            comment,
            createdAt,
            paymentType: "cash"
          }
        },
        remoteSyncError
      );
    }

    return res.json({
      ok: true,
      closedAmount: remaining,
      paymentId: Number(created.lastID),
      remoteSyncError
    });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: "Ошибка удаления долгов клиента" });
  }
});

app.delete("/api/clients/:id/full-delete", async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return res.status(400).json({ error: "Неверный clientId" });
    }

    const providedPin = String(
      req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
    ).trim();
    const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
    if (!providedPin || providedPin !== expectedPin) {
      return res.status(403).json({ error: "Нужны права администратора" });
    }

    const client = await get(
      "SELECT id, name FROM clients WHERE id = ?",
      [clientId]
    );
    if (!client) {
      return res.status(404).json({ error: "Клиент не найден" });
    }

    let stats = {
      payments: 0,
      syncRecords: 0,
      outboxOps: 0,
      salesItems: 0,
      sales: 0
    };

    await run("BEGIN IMMEDIATE TRANSACTION");

    try {
      // 1. Удаляем записи синхронизации
      const syncRecords = await all(
        "SELECT remote_record_id FROM debt_sync_records WHERE client_id = ?",
        [clientId]
      );
      if (syncRecords.length > 0) {
        const remoteIds = syncRecords.map(r => r.remote_record_id);
        await run(
          `DELETE FROM debt_sync_records WHERE remote_record_id IN (${remoteIds.map(() => '?').join(',')})`,
          remoteIds
        );
        stats.syncRecords = syncRecords.length;
      }

      // 2. Удаляем задачи синхронизации в очереди
      const outboxOps = await all(
        "SELECT id FROM debt_sync_outbox WHERE client_id = ?",
        [clientId]
      );
      if (outboxOps.length > 0) {
        await run("DELETE FROM debt_sync_outbox WHERE client_id = ?", [clientId]);
        stats.outboxOps = outboxOps.length;
      }

      // 3. Удаляем платежи (debt_payments)
      const payments = await all(
        "SELECT id FROM debt_payments WHERE client_id = ?",
        [clientId]
      );
      if (payments.length > 0) {
        const paymentIds = payments.map(p => p.id);
        await run(
          `DELETE FROM debt_sync_records WHERE local_payment_id IN (${paymentIds.map(() => '?').join(',')})`,
          paymentIds
        );
        await run("DELETE FROM debt_payments WHERE client_id = ?", [clientId]);
        stats.payments = payments.length;
      }

      // 4. Удаляем продажи (счета) клиента и их позиции
      const sales = await all(
        "SELECT id FROM sales WHERE client_id = ?",
        [clientId]
      );
      
      if (sales.length > 0) {
        for (const sale of sales) {
          const itemsResult = await run(
            "DELETE FROM sale_items WHERE sale_id = ?",
            [sale.id]
          );
          stats.salesItems += itemsResult.changes;

          await run(
            "DELETE FROM debt_sync_records WHERE local_sale_id = ?",
            [sale.id]
          );

          await run(
            "DELETE FROM debt_payments WHERE sale_id = ?",
            [sale.id]
          );
        }

        const saleIds = sales.map(s => s.id);
        const salesResult = await run(
          `DELETE FROM sales WHERE id IN (${saleIds.map(() => '?').join(',')})`,
          saleIds
        );
        stats.sales = salesResult.changes;
      }

      await run("COMMIT");

      return res.json({
        ok: true,
        message: `Клиент ${client.name} полностью очищен`,
        ...stats
      });

    } catch (innerErr) {
      await run("ROLLBACK");
      throw innerErr;
    }

  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: "Ошибка полного удаления операций клиента" });
  }
});

app.get("/api/reports/journal", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  try {
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();
    const saleCode = String(req.query.saleCode || "").trim();

    let whereClause = "";
    const whereParams = [];
    if (dateFrom) {
      const start = new Date(`${dateFrom}T00:00:00`);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ error: "Неверный формат dateFrom" });
      }
      whereClause += " s.created_at >= ? ";
      whereParams.push(start.toISOString());
    }
    if (dateTo) {
      const end = new Date(`${dateTo}T00:00:00`);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Неверный формат dateTo" });
      }
      end.setDate(end.getDate() + 1);
      whereClause += whereClause ? "AND s.created_at < ? " : " s.created_at < ? ";
      whereParams.push(end.toISOString());
    }
    if (saleCode) {
      whereClause += whereClause ? "AND LOWER(s.sale_code) LIKE ? " : " LOWER(s.sale_code) LIKE ? ";
      whereParams.push(`%${saleCode.toLowerCase()}%`);
    }

    const finalWhere = whereClause ? `WHERE ${whereClause}` : "";
    const sales = await all(
      `SELECT s.id, s.sale_code as saleCode, s.created_at as createdAt, s.cashier, s.payment_type as paymentType, s.total, s.comment,
              s.client_id as clientId, s.debt_total as debtTotal, s.is_return as isReturn, s.return_of_sale_id as returnOfSaleId,
              c.name as clientName, c.phone as clientPhone
       FROM sales s
       LEFT JOIN clients c ON c.id = s.client_id
       ${finalWhere}
       ORDER BY s.id DESC
       LIMIT ?`,
      [...whereParams, limit]
    );

    if (sales.length === 0) {
      return res.json([]);
    }

    const saleIds = sales.map((s) => s.id);
    const placeholders = saleIds.map(() => "?").join(", ");
    const items = await all(
      `SELECT sale_id as saleId, name, qty, unit, price FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY id ASC`,
      saleIds
    );
    const bySale = items.reduce((acc, item) => {
      if (!acc[item.saleId]) acc[item.saleId] = [];
      acc[item.saleId].push({
        name: item.name,
        qty: Number(item.qty),
        unit: item.unit || "шт",
        price: Number(item.price)
      });
      return acc;
    }, {});

    const result = await (() => {
        const salesRows = sales.map((sale) => ({
          id: sale.saleCode,
          createdAt: sale.createdAt,
          cashier: sale.cashier,
          paymentType: sale.paymentType,
          comment: sale.comment || "",
          clientId: sale.clientId ? Number(sale.clientId) : null,
          clientName: sale.clientName || "",
          clientPhone: sale.clientPhone || "",
          debtTotal: Number(sale.debtTotal || 0),
          isReturn: Number(sale.isReturn || 0) === 1,
          returnOfSaleId: sale.returnOfSaleId ? Number(sale.returnOfSaleId) : null,
          total: Number(sale.total),
          items: bySale[sale.id] || []
        }));

        const debtSaleIds = salesRows
          .filter((s) => s.paymentType === "debt")
          .map((s) => String(s.id));
        if (debtSaleIds.length === 0) {
          return salesRows;
        }

        return all(
          `SELECT s.sale_code as saleCode, COALESCE(SUM(dp.amount), 0) as paidTotal
           FROM debt_payments dp
           INNER JOIN sales s ON s.id = dp.sale_id
           WHERE s.sale_code IN (${debtSaleIds.map(() => "?").join(", ")})
           GROUP BY s.sale_code`,
          debtSaleIds
        ).then((paidRows) => {
          const paidMap = new Map(
            (paidRows || []).map((row) => [String(row.saleCode), Number(row.paidTotal || 0)])
          );
          return salesRows.map((sale) => {
            if (sale.paymentType !== "debt") return sale;
            const paidTotal = Number(paidMap.get(String(sale.id)) || 0);
            const debtTotal = Number(sale.debtTotal || 0);
            const status = paidTotal >= debtTotal && debtTotal > 0 ? "paid" : paidTotal > 0 ? "partial" : "unpaid";
            return { ...sale, debtPaidTotal: paidTotal, debtStatus: status };
          });
        });
      })();

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки журнала чеков" });
  }
});

app.get("/api/reports/monthly", async (req, res) => {
  try {
    const monthRaw = String(req.query.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthRaw)) {
      return res.status(400).json({ error: "Параметр month должен быть в формате YYYY-MM" });
    }

    const start = new Date(`${monthRaw}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: "Неверный month" });
    }
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const periodStart = start.toISOString();
    const periodEnd = end.toISOString();

    const salesAgg = await get(
      `SELECT COUNT(*) as checksCount, COALESCE(SUM(total), 0) as revenue
       FROM sales
       WHERE created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtSoldRow = await get(
      `SELECT COALESCE(SUM(debt_total), 0) as debtSold
       FROM sales
       WHERE payment_type = 'debt' AND created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtPaidRow = await get(
      `SELECT COALESCE(SUM(amount), 0) as debtPaid
       FROM debt_payments
       WHERE created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtOutstandingRow = await get(
      `SELECT
         COALESCE((SELECT SUM(s.debt_total) FROM sales s WHERE s.payment_type = 'debt' AND s.created_at < ?), 0) -
         COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.created_at < ?), 0) as debtOutstanding`,
      [periodEnd, periodEnd]
    );

    const itemsAgg = await all(
      `SELECT
         si.name,
         COALESCE(SUM(si.qty), 0) as qtyTotal,
         COALESCE(SUM(si.qty * si.price), 0) as amountTotal
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= ? AND s.created_at < ?
       GROUP BY si.name`,
      [periodStart, periodEnd]
    );

    const allItemsTotals = itemsAgg.reduce(
      (acc, row) => {
        acc.qty += Number(row.qtyTotal || 0);
        acc.amount += Number(row.amountTotal || 0);
        return acc;
      },
      { qty: 0, amount: 0 }
    );

    const serviceItems = buildFixedServiceItems(itemsAgg);
    const servicesTotals = serviceItems.reduce(
      (acc, row) => {
        acc.qty += Number(row.qty || 0);
        acc.amount += Number(row.amount || 0);
        return acc;
      },
      { qty: 0, amount: 0 }
    );

    const topItems = await all(
      `SELECT
         si.name,
         COALESCE(SUM(si.qty), 0) as qtyTotal,
         COALESCE(SUM(si.qty * si.price), 0) as amountTotal
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= ? AND s.created_at < ?
       GROUP BY si.name
       ORDER BY qtyTotal DESC, amountTotal DESC
       LIMIT 10`,
      [periodStart, periodEnd]
    );

    const summary = {
      servicesQty: servicesTotals.qty,
      servicesAmount: servicesTotals.amount,
      goodsQty: Math.max(0, allItemsTotals.qty - servicesTotals.qty),
      goodsAmount: Math.max(0, allItemsTotals.amount - servicesTotals.amount)
    };

    res.json({
      month: monthRaw,
      periodStart,
      periodEnd,
      checksCount: Number(salesAgg?.checksCount || 0),
      revenue: Number(salesAgg?.revenue || 0),
      debtSold: Number(debtSoldRow?.debtSold || 0),
      debtPaid: Number(debtPaidRow?.debtPaid || 0),
      debtOutstanding: Math.max(0, Number(debtOutstandingRow?.debtOutstanding || 0)),
      ...summary,
      serviceItems,
      topItems: topItems.map((r) => ({
        name: r.name,
        qty: Number(r.qtyTotal || 0),
        amount: Number(r.amountTotal || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Ошибка формирования месячного отчета" });
  }
});

app.get("/api/reports/daily", async (req, res) => {
  try {
    const dateRaw = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return res.status(400).json({ error: "Параметр date должен быть в формате YYYY-MM-DD" });
    }

    const start = new Date(`${dateRaw}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: "Неверный date" });
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const periodStart = start.toISOString();
    const periodEnd = end.toISOString();

    const salesAgg = await get(
      `SELECT COUNT(*) as checksCount, COALESCE(SUM(total), 0) as revenue
       FROM sales
       WHERE created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtSoldRow = await get(
      `SELECT COALESCE(SUM(debt_total), 0) as debtSold
       FROM sales
       WHERE payment_type = 'debt' AND created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtPaidRow = await get(
      `SELECT COALESCE(SUM(amount), 0) as debtPaid
       FROM debt_payments
       WHERE created_at >= ? AND created_at < ?`,
      [periodStart, periodEnd]
    );
    const debtOutstandingRow = await get(
      `SELECT
         COALESCE((SELECT SUM(s.debt_total) FROM sales s WHERE s.payment_type = 'debt' AND s.created_at < ?), 0) -
         COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.created_at < ?), 0) as debtOutstanding`,
      [periodEnd, periodEnd]
    );

    const itemsAgg = await all(
      `SELECT
         si.name,
         COALESCE(SUM(si.qty), 0) as qtyTotal,
         COALESCE(SUM(si.qty * si.price), 0) as amountTotal
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= ? AND s.created_at < ?
       GROUP BY si.name`,
      [periodStart, periodEnd]
    );

    const allItemsTotals = itemsAgg.reduce(
      (acc, row) => {
        acc.qty += Number(row.qtyTotal || 0);
        acc.amount += Number(row.amountTotal || 0);
        return acc;
      },
      { qty: 0, amount: 0 }
    );

    const serviceItems = buildFixedServiceItems(itemsAgg);
    const servicesTotals = serviceItems.reduce(
      (acc, row) => {
        acc.qty += Number(row.qty || 0);
        acc.amount += Number(row.amount || 0);
        return acc;
      },
      { qty: 0, amount: 0 }
    );

    const summary = {
      servicesQty: servicesTotals.qty,
      servicesAmount: servicesTotals.amount,
      goodsQty: Math.max(0, allItemsTotals.qty - servicesTotals.qty),
      goodsAmount: Math.max(0, allItemsTotals.amount - servicesTotals.amount)
    };

    res.json({
      date: dateRaw,
      periodStart,
      periodEnd,
      checksCount: Number(salesAgg?.checksCount || 0),
      revenue: Number(salesAgg?.revenue || 0),
      debtSold: Number(debtSoldRow?.debtSold || 0),
      debtPaid: Number(debtPaidRow?.debtPaid || 0),
      debtOutstanding: Math.max(0, Number(debtOutstandingRow?.debtOutstanding || 0)),
      ...summary,
      serviceItems
    });
  } catch (err) {
    res.status(500).json({ error: "Ошибка формирования дневного отчета" });
  }
});

async function getXReportData() {
  const shiftRow = await get("SELECT * FROM shifts WHERE id = 1");
  const lastZAt = await getLastZAt();

  const totals = await get(
    "SELECT COUNT(*) as salesCount, COALESCE(SUM(total), 0) as revenue FROM sales WHERE created_at > ?",
    [lastZAt]
  );
  const byPaymentRows = await all(
    "SELECT payment_type as paymentType, SUM(total) as total FROM sales WHERE created_at > ? GROUP BY payment_type",
    [lastZAt]
  );
  const recentSales = await all(
    "SELECT sale_code as id, created_at as createdAt, cashier, payment_type as paymentType, total FROM sales WHERE created_at > ? ORDER BY id DESC LIMIT 20",
    [lastZAt]
  );

  const byPayment = byPaymentRows.reduce((acc, row) => {
    acc[row.paymentType] = Number(row.total || 0);
    return acc;
  }, {});

  return {
    shift: mapShift(shiftRow),
    periodStart: lastZAt,
    periodEnd: new Date().toISOString(),
    salesCount: Number(totals.salesCount || 0),
    revenue: Number(totals.revenue || 0),
    byPayment,
    recentSales
  };
}

async function getXReportDataByDate(dateRaw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    throw new Error("Параметр date должен быть в формате YYYY-MM-DD");
  }

  const start = new Date(`${dateRaw}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Неверный date");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const periodStart = start.toISOString();
  const periodEnd = end.toISOString();

  const totals = await get(
    "SELECT COUNT(*) as salesCount, COALESCE(SUM(total), 0) as revenue FROM sales WHERE created_at >= ? AND created_at < ?",
    [periodStart, periodEnd]
  );
  const byPaymentRows = await all(
    "SELECT payment_type as paymentType, SUM(total) as total FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY payment_type",
    [periodStart, periodEnd]
  );
  const recentSales = await all(
    "SELECT sale_code as id, created_at as createdAt, cashier, payment_type as paymentType, total FROM sales WHERE created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 20",
    [periodStart, periodEnd]
  );

  const byPayment = byPaymentRows.reduce((acc, row) => {
    acc[row.paymentType] = Number(row.total || 0);
    return acc;
  }, {});

  return {
    shift: null,
    date: dateRaw,
    periodStart,
    periodEnd,
    salesCount: Number(totals.salesCount || 0),
    revenue: Number(totals.revenue || 0),
    byPayment,
    recentSales
  };
}

app.post("/api/sales", async (req, res) => {
  const { cashier, paymentType, items } = req.body;
  const normalizedPaymentType = String(paymentType || "").trim().toLowerCase();
  const comment = formatCommentPhone(String(req.body?.comment || "").trim().slice(0, 120));
  const clientId = req.body?.clientId ? Number(req.body.clientId) : null;
  const requestedSaleCode = String(req.body?.saleCode || "").trim();

  if (!cashier || !normalizedPaymentType || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Неверные данные продажи" });
  }
  if (!["cash", "card", "debt"].includes(normalizedPaymentType)) {
    return res.status(400).json({ error: "paymentType должен быть cash, card или debt" });
  }

  try {
    const shiftRow = await get("SELECT * FROM shifts WHERE id = 1");
    if (!shiftRow || !shiftRow.is_open) {
      return res.status(400).json({ error: "Смена закрыта" });
    }

    await run("BEGIN IMMEDIATE TRANSACTION");

    const normalizedItems = [];

    for (const item of items) {
      const product = await get(
        "SELECT id, sku, name, unit FROM products WHERE id = ?",
        [item.productId]
      );

      if (!product) {
        throw new Error(`Товар не найден: ${item.productId}`);
      }

      const qty = Number(item.qty);
      const price = Number(item.price);

      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Некорректное количество для ${product.name}`);
      }

      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Некорректная цена для ${product.name}`);
      }

      normalizedItems.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit || "шт",
        qty: Number(qty.toFixed(3)),
        price
      });
    }

    const total = Number(
      normalizedItems.reduce((acc, item) => acc + item.qty * item.price, 0).toFixed(2)
    );
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error("Сумма чека должна быть больше 0");
    }
    let client = null;
    if (Number.isInteger(clientId) && clientId > 0) {
      client = await get(
        "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
        [clientId]
      );
      if (!client) {
        throw new Error("Клиент не найден");
      }
    }
    if (normalizedPaymentType === "debt" && !client) {
      throw new Error("Для продажи в долг выберите клиента");
    }

    const createdAt = new Date().toISOString();
    let saleCode = "";
    if (requestedSaleCode) {
      if (!/^\d+$/.test(requestedSaleCode)) {
        throw new Error("Неверный номер чека");
      }
      const exists = await get("SELECT id FROM sales WHERE sale_code = ?", [requestedSaleCode]);
      if (exists) {
        throw new Error("Номер чека уже использован");
      }
      saleCode = requestedSaleCode;
      const currentNext = Number(await getSetting("sales.nextNumber", "100")) || 100;
      const desiredNext = Number(requestedSaleCode) + 1;
      if (Number.isFinite(desiredNext) && desiredNext > currentNext) {
        await setSetting("sales.nextNumber", String(desiredNext));
      }
    } else {
      saleCode = await getAndReserveNextSaleCode();
    }
    const debtTotal = normalizedPaymentType === "debt" ? total : 0;

    const saleInsert = await run(
      "INSERT INTO sales (sale_code, created_at, cashier, payment_type, total, comment, client_id, debt_total, is_return, return_of_sale_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)",
      [saleCode, createdAt, cashier, normalizedPaymentType, total, comment, client ? client.id : null, debtTotal]
    );

    for (const item of normalizedItems) {
      await run(
        "INSERT INTO sale_items (sale_id, product_id, sku, name, qty, unit, price) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [saleInsert.lastID, item.productId, item.sku, item.name, item.qty, item.unit || "шт", item.price]
      );
    }

    await run("COMMIT");

    let remoteSyncError = "";
    if (normalizedPaymentType === "debt" && client) {
      try {
        await syncLocalDebtSaleToRemote(client, {
          dbId: Number(saleInsert.lastID),
          id: saleCode,
          total,
          debtTotal,
          comment,
          createdAt
        });
      } catch (syncErr) {
        remoteSyncError = String(syncErr.message || "Ошибка синхронизации долга").slice(0, 220);
        await enqueueRemoteSyncOp(
          "sale_add",
          Number(client.id),
          {
            sale: {
              dbId: Number(saleInsert.lastID),
              id: saleCode,
              total,
              debtTotal,
              comment,
              createdAt
            }
          },
          remoteSyncError
        );
      }
    }

    res.status(201).json({
      id: saleCode,
      createdAt,
      cashier,
      paymentType: normalizedPaymentType,
      clientId: client ? Number(client.id) : null,
      clientName: client ? client.name : "",
      clientPhone: client ? client.phone || "" : "",
      debtTotal,
      comment,
      total,
      items: normalizedItems,
      remoteSyncError
    });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    res.status(400).json({ error: err.message || "Ошибка продажи" });
  }
});

app.post("/api/sales/reserve", async (req, res) => {
  try {
    const shiftRow = await get("SELECT * FROM shifts WHERE id = 1");
    if (!shiftRow || !shiftRow.is_open) {
      return res.status(400).json({ error: "Смена закрыта" });
    }
    const saleCode = await getAndReserveNextSaleCode();
    return res.json({ saleCode });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Не удалось получить номер чека" });
  }
});

app.get("/api/sales/:saleCode", async (req, res) => {
  const saleCode = String(req.params.saleCode || "").trim();
  if (!saleCode) {
    return res.status(400).json({ error: "Неверный код чека" });
  }

  try {
    const sale = await get(
      `SELECT s.id, s.sale_code as saleCode, s.created_at as createdAt, s.cashier, s.payment_type as paymentType,
              s.total, s.comment, s.client_id as clientId, s.debt_total as debtTotal, s.is_return as isReturn,
              s.return_of_sale_id as returnOfSaleId, c.name as clientName, c.phone as clientPhone
       FROM sales s
       LEFT JOIN clients c ON c.id = s.client_id
       WHERE s.sale_code = ?`,
      [saleCode]
    );
    if (!sale) {
      return res.status(404).json({ error: "Чек не найден" });
    }

    const items = await all(
      "SELECT id as itemId, name, qty, unit, price FROM sale_items WHERE sale_id = ? ORDER BY id ASC",
      [sale.id]
    );

    return res.json({
      id: sale.saleCode,
      createdAt: sale.createdAt,
      cashier: sale.cashier,
      paymentType: sale.paymentType,
      comment: sale.comment || "",
      clientId: sale.clientId ? Number(sale.clientId) : null,
      clientName: sale.clientName || "",
      clientPhone: sale.clientPhone || "",
      debtTotal: Number(sale.debtTotal || 0),
      isReturn: Number(sale.isReturn || 0) === 1,
      returnOfSaleId: sale.returnOfSaleId ? Number(sale.returnOfSaleId) : null,
      total: Number(sale.total || 0),
      items: items.map((it) => ({
        itemId: Number(it.itemId),
        name: it.name,
        qty: Number(it.qty || 0),
        unit: it.unit || "шт",
        price: Number(it.price || 0)
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: "Ошибка загрузки чека" });
  }
});

app.post("/api/sales/:saleCode/return", async (req, res) => {
  const saleCode = String(req.params.saleCode || "").trim();
  if (!saleCode) {
    return res.status(400).json({ error: "Неверный код чека" });
  }

  try {
    const providedPin = String(
      req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
    ).trim();
    const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
    if (!providedPin || providedPin !== expectedPin) {
      return res.status(403).json({ error: "Нужны права администратора" });
    }

    const sale = await get(
      `SELECT id, sale_code as saleCode, payment_type as paymentType, cashier, client_id as clientId,
              total, comment, is_return as isReturn
       FROM sales
       WHERE sale_code = ?`,
      [saleCode]
    );
    if (!sale) {
      return res.status(404).json({ error: "Чек не найден" });
    }
    if (Number(sale.isReturn || 0) === 1) {
      return res.status(400).json({ error: "Нельзя делать возврат по чеку возврата" });
    }

    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!requestedItems.length) {
      return res.status(400).json({ error: "Не выбраны позиции для возврата" });
    }

    const saleItems = await all(
      "SELECT id, product_id as productId, sku, name, qty, unit, price FROM sale_items WHERE sale_id = ? ORDER BY id ASC",
      [sale.id]
    );
    if (!saleItems.length) {
      return res.status(400).json({ error: "В чеке нет позиций для возврата" });
    }
    const byId = new Map(saleItems.map((it) => [Number(it.id), it]));

    const returnItems = [];
    for (const raw of requestedItems) {
      const itemId = Number(raw?.itemId);
      const qty = Number(raw?.qty);
      if (!Number.isFinite(itemId) || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: "Некорректные данные возврата" });
      }
      const orig = byId.get(itemId);
      if (!orig) {
        return res.status(400).json({ error: "Позиция для возврата не найдена" });
      }
      const maxQty = Math.abs(Number(orig.qty || 0));
      if (qty > maxQty) {
        return res.status(400).json({ error: "Количество возврата больше продажи" });
      }
      const returnQty = -Math.abs(qty);
      returnItems.push({
        productId: orig.productId,
        sku: orig.sku,
        name: orig.name,
        qty: returnQty,
        unit: orig.unit || "шт",
        price: Number(orig.price || 0)
      });
    }

    if (returnItems.length === 0) {
      return res.status(400).json({ error: "Не выбраны позиции для возврата" });
    }

    const createdAt = new Date().toISOString();
    const returnSaleCode = await getAndReserveNextSaleCode();
    const total = Number(returnItems.reduce((acc, item) => acc + item.qty * item.price, 0).toFixed(2));
    const debtTotal = sale.paymentType === "debt" ? total : 0;
    const comment = `Возврат по чеку ${sale.saleCode}`;

    await run("BEGIN IMMEDIATE TRANSACTION");
    const saleInsert = await run(
      "INSERT INTO sales (sale_code, created_at, cashier, payment_type, total, comment, client_id, debt_total, is_return, return_of_sale_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
      [
        returnSaleCode,
        createdAt,
        sale.cashier || "Кассир",
        sale.paymentType,
        total,
        comment,
        sale.clientId ? Number(sale.clientId) : null,
        debtTotal,
        Number(sale.id)
      ]
    );

    for (const item of returnItems) {
      await run(
        "INSERT INTO sale_items (sale_id, product_id, sku, name, qty, unit, price) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          Number(saleInsert.lastID),
          item.productId,
          item.sku,
          item.name,
          item.qty,
          item.unit || "шт",
          item.price
        ]
      );
    }
    await run("COMMIT");

    let remoteSyncError = "";
    if (sale.paymentType === "debt" && sale.clientId) {
      const client = await get(
        "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
        [sale.clientId]
      );
      if (client) {
        try {
          await enqueueRemoteSyncOp("sale_add", Number(client.id), {
            sale: {
              dbId: Number(saleInsert.lastID),
              id: returnSaleCode,
              total,
              debtTotal,
              comment
            }
          });
        } catch (err) {
          remoteSyncError = err.message || "Ошибка очереди синхронизации";
        }
      }
    }

    return res.json({ ok: true, id: returnSaleCode, remoteSyncError });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: err.message || "Ошибка возврата" });
  }
});

app.delete("/api/sales/:saleCode", async (req, res) => {
  const saleCode = String(req.params.saleCode || "").trim();
  if (!saleCode) {
    return res.status(400).json({ error: "Неверный код чека" });
  }

  try {
    const sale = await get(
      `SELECT id, sale_code as saleCode, payment_type as paymentType, client_id as clientId,
              total, debt_total as debtTotal, comment
       FROM sales
       WHERE sale_code = ?`,
      [saleCode]
    );
    if (!sale) {
      return res.status(404).json({ error: "Чек не найден" });
    }

    if (sale.paymentType === "debt") {
      const providedPin = String(
        req.body?.adminPin || req.query?.adminPin || req.headers["x-admin-pin"] || ""
      ).trim();
      const expectedPin = String(await getSetting("debt.adminPin", "1234")).trim();
      if (!providedPin || providedPin !== expectedPin) {
        return res.status(403).json({ error: "Нужны права администратора для удаления чека в долг" });
      }
    }

    const client =
      sale.paymentType === "debt" && sale.clientId
        ? await get(
            "SELECT id, name, phone, external_debtor_id as externalDebtorId FROM clients WHERE id = ?",
            [sale.clientId]
          )
        : null;

    const linkedPayments =
      sale.paymentType === "debt"
        ? await all("SELECT id FROM debt_payments WHERE sale_id = ?", [sale.id])
        : [];

    await run("BEGIN IMMEDIATE TRANSACTION");
    if (sale.paymentType === "debt") {
      await run("DELETE FROM debt_payments WHERE sale_id = ?", [sale.id]);
    }
    await run("DELETE FROM sale_items WHERE sale_id = ?", [sale.id]);
    await run("DELETE FROM sales WHERE id = ?", [sale.id]);
    await run("COMMIT");

    let remoteSyncError = "";
    if (sale.paymentType === "debt" && client) {
      try {
        await tryDeleteRemoteDebtRecordByLocalSale(client, {
          dbId: Number(sale.id),
          id: sale.saleCode,
          total: Number(sale.total || 0),
          debtTotal: Number(sale.debtTotal || 0),
          comment: sale.comment || ""
        });
        for (const pay of linkedPayments) {
          await tryDeleteRemotePaymentRecordByLocalPayment(client, Number(pay.id));
        }
        const linkedPaymentIds = linkedPayments
          .map((p) => Number(p.id))
          .filter((id) => Number.isInteger(id) && id > 0);
        await run("DELETE FROM debt_sync_records WHERE local_sale_id = ?", [sale.id]);
        if (linkedPaymentIds.length > 0) {
          const placeholders = linkedPaymentIds.map(() => "?").join(", ");
          await run(`DELETE FROM debt_sync_records WHERE local_payment_id IN (${placeholders})`, linkedPaymentIds);
        }
      } catch (syncErr) {
        remoteSyncError = String(syncErr.message || "Ошибка удаления записи в remote debt-tracker").slice(0, 220);
        await enqueueRemoteSyncOp(
          "sale_delete",
          Number(client.id),
          {
            sale: {
              dbId: Number(sale.id),
              id: sale.saleCode,
              total: Number(sale.total || 0),
              debtTotal: Number(sale.debtTotal || 0),
              comment: sale.comment || ""
            }
          },
          remoteSyncError
        );
        for (const pay of linkedPayments) {
          const pid = Number(pay.id || 0);
          if (!Number.isInteger(pid) || pid <= 0) continue;
          await enqueueRemoteSyncOp(
            "payment_delete",
            Number(client.id),
            { paymentId: pid },
            remoteSyncError
          );
        }
      }
    }

    return res.json({ ok: true, id: sale.saleCode, remoteSyncError });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {
      // no-op
    }
    return res.status(500).json({ error: "Ошибка удаления чека" });
  }
});

app.get("/api/reports/x", async (req, res) => {
  try {
    const dateRaw = String(req.query.date || "").trim();
    const report = dateRaw ? await getXReportDataByDate(dateRaw) : await getXReportData();
    res.json(report);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("YYYY-MM-DD") || msg.includes("Неверный date")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Ошибка формирования отчета" });
  }
});

app.get("/api/reports/z", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  try {
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();

    let whereClause = "";
    const whereParams = [];
    if (dateFrom) {
      const start = new Date(`${dateFrom}T00:00:00`);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ error: "Неверный формат dateFrom" });
      }
      whereClause += " created_at >= ? ";
      whereParams.push(start.toISOString());
    }
    if (dateTo) {
      const end = new Date(`${dateTo}T00:00:00`);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Неверный формат dateTo" });
      }
      end.setDate(end.getDate() + 1);
      whereClause += whereClause ? "AND created_at < ? " : " created_at < ? ";
      whereParams.push(end.toISOString());
    }

    const finalWhere = whereClause ? `WHERE ${whereClause}` : "";
    const reports = await all(
      `SELECT id, created_at as createdAt, period_start as periodStart, period_end as periodEnd, sales_count as salesCount, revenue, cash_total as cashTotal, card_total as cardTotal
       FROM z_reports
       ${finalWhere}
       ORDER BY id DESC
       LIMIT ?`,
      [...whereParams, limit]
    );
    res.json(
      reports.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        salesCount: Number(r.salesCount),
        revenue: Number(r.revenue),
        cashTotal: Number(r.cashTotal),
        cardTotal: Number(r.cardTotal)
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки Z-отчета" });
  }
});

app.post("/api/reports/z/close", async (req, res) => {
  try {
    const x = await getXReportData();
    const createdAt = new Date().toISOString();
    const cashTotal = Number(x.byPayment.cash || 0);
    const cardTotal = Number(x.byPayment.card || 0);

    await run(
      "INSERT INTO z_reports (created_at, period_start, period_end, sales_count, revenue, cash_total, card_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [createdAt, x.periodStart, createdAt, x.salesCount, x.revenue, cashTotal, cardTotal]
    );
    await setLastZAt(createdAt);

    res.json({
      ok: true,
      createdAt,
      periodStart: x.periodStart,
      periodEnd: createdAt,
      salesCount: x.salesCount,
      revenue: x.revenue,
      cashTotal,
      cardTotal
    });
  } catch (err) {
    res.status(500).json({ error: "Ошибка снятия Z-отчета" });
  }
});

app.post("/api/shifts/open", async (req, res) => {
  const { cashier } = req.body;
  try {
    const shiftRow = await get("SELECT * FROM shifts WHERE id = 1");
    if (shiftRow && shiftRow.is_open) {
      return res.status(400).json({ error: "Смена уже открыта" });
    }

    const openedAt = new Date().toISOString();
    await run(
      "UPDATE shifts SET is_open = 1, opened_at = ?, closed_at = NULL, cashier = ? WHERE id = 1",
      [openedAt, cashier || "Кассир 1"]
    );

    const updated = await get("SELECT * FROM shifts WHERE id = 1");
    res.json(mapShift(updated));
  } catch (err) {
    res.status(500).json({ error: "Ошибка открытия смены" });
  }
});

app.post("/api/shifts/close", async (req, res) => {
  try {
    const shiftRow = await get("SELECT * FROM shifts WHERE id = 1");
    if (!shiftRow || !shiftRow.is_open) {
      return res.status(400).json({ error: "Смена уже закрыта" });
    }

    const closedAt = new Date().toISOString();
    await run("UPDATE shifts SET is_open = 0, closed_at = ? WHERE id = 1", [closedAt]);

    const updated = await get("SELECT * FROM shifts WHERE id = 1");
    res.json(mapShift(updated));
  } catch (err) {
    res.status(500).json({ error: "Ошибка закрытия смены" });
  }
});

// Stock Receipt API
app.get("/api/stock-receipts", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const receipts = await all(
      `SELECT id, code, created_at as createdAt, cashier, comment, 
              total_cost as totalCost, total_retail as totalRetail
       FROM stock_receipts
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(receipts.map(r => ({
      id: r.id,
      code: r.code,
      createdAt: r.createdAt,
      cashier: r.cashier || "",
      comment: r.comment || "",
      totalCost: Number(r.totalCost || 0),
      totalRetail: Number(r.totalRetail || 0)
    })));
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки приходов" });
  }
});

app.get("/api/stock-receipts/:code", async (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Код прихода обязателен" });
  }
  try {
    const receipt = await get(
      `SELECT id, code, created_at as createdAt, cashier, comment,
              total_cost as totalCost, total_retail as totalRetail
       FROM stock_receipts
       WHERE code = ?`,
      [code]
    );
    if (!receipt) {
      return res.status(404).json({ error: "Приход не найден" });
    }
    const items = await all(
      `SELECT id, product_id as productId, sku, name, qty, unit, 
              cost_price as costPrice, price, min_price as minPrice
       FROM stock_receipt_items
       WHERE receipt_id = ?
       ORDER BY id ASC`,
      [receipt.id]
    );
    res.json({
      id: receipt.id,
      code: receipt.code,
      createdAt: receipt.createdAt,
      cashier: receipt.cashier || "",
      comment: receipt.comment || "",
      totalCost: Number(receipt.totalCost || 0),
      totalRetail: Number(receipt.totalRetail || 0),
      items: items.map(item => ({
        id: item.id,
        productId: item.productId || null,
        sku: item.sku || "",
        name: item.name,
        qty: Number(item.qty || 0),
        unit: item.unit || "шт",
        costPrice: Number(item.costPrice || 0),
        price: Number(item.price || 0),
        minPrice: Number(item.minPrice || 0)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки прихода" });
  }
});

app.post("/api/stock-receipts", async (req, res) => {
  const { cashier, comment, items } = req.body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Добавьте товары в приход" });
  }

  try {
    const code = await getAndReserveNextStockCode();
    const createdAt = new Date().toISOString();
    
    const totalCost = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.costPrice || 0), 0);
    const totalRetail = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);

    await run("BEGIN IMMEDIATE TRANSACTION");

    const receiptInsert = await run(
      `INSERT INTO stock_receipts (code, created_at, cashier, comment, total_cost, total_retail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, createdAt, cashier || "Кассир", comment || "", 
       Number(totalCost.toFixed(2)), Number(totalRetail.toFixed(2))]
    );

    for (const item of items) {
      let productId = item.productId;
      let sku = item.sku;

      // If new product - create it
      if (!productId && item.isNew) {
        const product = await get(
          "SELECT id, sku, price, min_price as minPrice, stock FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
          [item.name]
        );

        if (product) {
          productId = product.id;
          sku = product.sku;
          // Update price if changed
          const newPrice = Number(item.price.toFixed(2));
          const newMinPrice = Number(item.minPrice || item.price || 0);
          if (Number(product.price) !== newPrice) {
            await run(
              "UPDATE products SET price = ?, min_price = ?, stock = stock + ? WHERE id = ?",
              [newPrice, newMinPrice || newPrice, Number(item.qty), productId]
            );
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, old_price, new_price, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, sku, "stock_receipt_update", Number(item.qty), 
               Number(product.price || 0), newPrice, `Приход: ${code}`]
            );
          } else if (Number(product.minPrice || 0) !== Number(newMinPrice)) {
            // Update just min_price
            await run("UPDATE products SET min_price = ?, stock = stock + ? WHERE id = ?",
              [newMinPrice, Number(item.qty), productId]);
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, comment)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, sku, "stock_receipt", Number(item.qty), `Приход: ${code}`]
            );
          } else {
            // Just add stock
            await run("UPDATE products SET stock = stock + ? WHERE id = ?", [Number(item.qty), productId]);
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, comment)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, sku, "stock_receipt", Number(item.qty), `Приход: ${code}`]
            );
          }
        } else {
          // Create new product
          const id = makeProductId();
          const autoSku = makeAutoSku();
          productId = id;
          sku = autoSku;
          const newMinPrice = Number(item.minPrice || item.price || 0);
          await run(
            `INSERT INTO products (id, sku, name, category, unit, price, min_price, stock)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, autoSku, item.name, item.category || "Без категории", 
             item.unit || "шт", Number(item.price.toFixed(2)), 
             newMinPrice || Number(item.price.toFixed(2)), Number(item.qty)]
          );
          await run(
            `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, new_price, comment)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [createdAt, id, autoSku, "create", Number(item.qty), 
             Number(item.price.toFixed(2)), `Приход: ${code}`]
          );
        }

        await run(
          `INSERT INTO stock_receipt_items 
           (receipt_id, product_id, sku, name, qty, unit, cost_price, price, min_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [receiptInsert.lastID, productId || null, sku || "", item.name, 
           Number(item.qty.toFixed(3)), item.unit || "шт", 
           Number(item.costPrice.toFixed(2)), Number(item.price.toFixed(2)),
           Number(item.minPrice || 0)]
        );
      } else if (productId) {
        // Existing product - add stock
        const existingProduct = await get(
          "SELECT id, sku, price, min_price as minPrice, stock FROM products WHERE id = ?",
          [productId]
        );
        
        if (existingProduct) {
          const skuValue = existingProduct.sku;
          sku = skuValue;
          const newPrice = Number(item.price.toFixed(2));
          const newMinPrice = Number(item.minPrice || item.price || 0);
          if (Number(existingProduct.price) !== newPrice) {
            await run("UPDATE products SET price = ?, min_price = ?, stock = stock + ? WHERE id = ?",
              [newPrice, newMinPrice || newPrice, Number(item.qty), productId]);
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, old_price, new_price, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, skuValue, "stock_receipt_update", Number(item.qty),
               Number(existingProduct.price || 0), newPrice, `Приход: ${code}`]
            );
          } else if (Number(existingProduct.minPrice || 0) !== Number(newMinPrice)) {
            // Update just min_price
            await run("UPDATE products SET min_price = ?, stock = stock + ? WHERE id = ?",
              [newMinPrice, Number(item.qty), productId]);
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, comment)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, skuValue, "stock_receipt", Number(item.qty), `Приход: ${code}`]
            );
          } else {
            await run("UPDATE products SET stock = stock + ? WHERE id = ?", [Number(item.qty), productId]);
            await run(
              `INSERT INTO inventory_ops (created_at, product_id, sku, operation, qty_delta, comment)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [createdAt, productId, skuValue, "stock_receipt", Number(item.qty), `Приход: ${code}`]
            );
          }
        }

        await run(
          `INSERT INTO stock_receipt_items 
           (receipt_id, product_id, sku, name, qty, unit, cost_price, price, min_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [receiptInsert.lastID, productId, sku || "", item.name,
           Number(item.qty.toFixed(3)), item.unit || "шт",
           Number(item.costPrice.toFixed(2)), Number(item.price.toFixed(2)),
           Number(item.minPrice || 0)]
        );
      }
    }

    await run("COMMIT");
    res.status(201).json({ id: receiptInsert.lastID, code });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ error: "Ошибка сохранения прихода" });
  }
});

app.post("/api/stock-receipts/:code/print", async (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Код прихода обязателен" });
  }

  try {
    const receipt = await get(
      `SELECT id, code, created_at as createdAt, cashier, comment,
              total_cost as totalCost, total_retail as totalRetail
       FROM stock_receipts
       WHERE code = ?`,
      [code]
    );
    if (!receipt) {
      return res.status(404).json({ error: "Приход не найден" });
    }
    const items = await all(
      `SELECT name, qty, unit, cost_price as costPrice, price, min_price as minPrice
       FROM stock_receipt_items
       WHERE receipt_id = ?
       ORDER BY id ASC`,
      [receipt.id]
    );

    const printReceipt = {
      code: receipt.code,
      createdAt: receipt.createdAt,
      cashier: receipt.cashier || "Кассир",
      items: items.map(item => ({
        name: item.name,
        qty: Number(item.qty || 0),
        unit: item.unit || "шт",
        costPrice: Number(item.costPrice || 0),
        price: Number(item.price || 0),
        minPrice: item.minPrice ? Number(item.minPrice) : Number(item.price || 0)
      })),
      totalCost: Number(receipt.totalCost || 0),
      totalRetail: Number(receipt.totalRetail || 0),
      comment: receipt.comment || ""
    };

    const config = await getPrintConfig();
    const payload = buildEscPosStockReceipt(printReceipt, config);
    await sendToPrinter(payload, config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка печати прихода" });
  }
});

app.post("/api/stock-receipts/print-only", async (req, res) => {
  const { cashier, items } = req.body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Добавьте товары в приход" });
  }

  try {
    const code = `TMP-${Date.now()}`;
    const receipt = {
      code,
      createdAt: new Date().toISOString(),
      cashier: cashier || "Кассир",
      items: items.map(item => ({
        name: item.name,
        qty: Number(item.qty.toFixed(3)),
        unit: item.unit || "шт",
        costPrice: Number(item.costPrice.toFixed(2)),
        price: Number(item.price.toFixed(2)),
        minPrice: item.minPrice ? Number(item.minPrice) : Number(item.price.toFixed(2))
      })),
      totalCost: items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.costPrice || 0), 0),
      totalRetail: items.reduce((sum, item) => sum + Number(item.qty || 0) * (item.minPrice ? Number(item.minPrice) : Number(item.price)), 0),
      comment: ""
    };

    const config = await getPrintConfig();
    const payload = buildEscPosStockReceipt(receipt, config);
    await sendToPrinter(payload, config);
    res.json({ ok: true, code });
  } catch (err) {
    res.status(500).json({ error: "Ошибка печати прихода" });
  }
});

app.delete("/api/stock-receipts/:code", async (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) {
    return res.status(400).json({ error: "Код прихода обязателен" });
  }

  try {
    const receipt = await get("SELECT id FROM stock_receipts WHERE code = ?", [code]);
    if (!receipt) {
      return res.status(404).json({ error: "Приход не найден" });
    }

    await run("BEGIN IMMEDIATE TRANSACTION");
    await run("DELETE FROM stock_receipt_items WHERE receipt_id = (SELECT id FROM stock_receipts WHERE code = ?)", [code]);
    await run("DELETE FROM stock_receipts WHERE code = ?", [code]);
    await run("COMMIT");

    res.json({ ok: true, code });
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ error: "Ошибка удаления прихода" });
  }
});

async function seedDemoData() {
  try {
    // Check if products already exist
    const products = await all("SELECT COUNT(*) as count FROM products");
    if (products[0].count > 0) {
      console.log("Database already has data, skipping demo seed");
      return;
    }

    console.log("Creating demo data...");

    // Add categories
    await run("INSERT INTO categories (name) VALUES (?)", ["Напитки"]);
    await run("INSERT INTO categories (name) VALUES (?)", ["Еда"]);
    await run("INSERT INTO categories (name) VALUES (?)", ["Снеки"]);

    // Add products
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_1", "SKU001", "Вода 0.5л", "Напитки", "шт", 100, 50]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_2", "SKU002", "Coca-Cola 0.5л", "Напитки", "шт", 150, 30]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_3", "SKU003", "Чай горячий", "Напитки", "шт", 120, 40]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_4", "SKU004", "Булочка", "Еда", "шт", 80, 60]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_5", "SKU005", "Бутерброд", "Еда", "шт", 200, 25]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_6", "SKU006", "Чипсы", "Снеки", "шт", 70, 100]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, unit, price, stock) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["prod_7", "SKU007", "Печенье", "Снеки", "шт", 60, 80]
    );

    // Add a test client
    await run(
      `INSERT INTO clients (name, phone, note, created_at) 
       VALUES (?, ?, ?, ?)`,
      ["Иван Иванов", "+7 (999) 111-22-33", "VIP клиент", new Date().toISOString()]
    );

    console.log("Demo data created successfully!");
  } catch (err) {
    console.error("Error creating demo data:", err);
  }
}

initDb()
  .then(async () => {
    await seedDemoData();
    const config = await getPrintConfig();
    setInterval(() => {
      processRemoteSyncOutbox().catch(() => {
        // background retry; error is stored in outbox row
      });
    }, 30000);
    processRemoteSyncOutbox().catch(() => {
      // no-op at startup
    });
    app.listen(PORT, () => {
      console.log(`Web Kassa running on http://localhost:${PORT}`);
      console.log(`SQLite DB: ${DB_PATH}`);
      if (config.transport === "com") {
        console.log(`ESC/POS printer: ${config.comPort} @ ${config.comBaudRate}`);
      } else {
        console.log(`ESC/POS printer: ${config.host}:${config.port}`);
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialize DB", err);
    process.exit(1);
  });
