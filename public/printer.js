const transportInput = document.getElementById("printerTransport");
const hostInput = document.getElementById("printerHost");
const portInput = document.getElementById("printerPort");
const comPortInput = document.getElementById("printerComPort");
const comBaudInput = document.getElementById("printerComBaud");
const charsInput = document.getElementById("printerChars");
const codePageInput = document.getElementById("printerCodePage");
const tcpFields = document.getElementById("tcpFields");
const comFields = document.getElementById("comFields");
const saveBtn = document.getElementById("savePrinterBtn");
const testBtn = document.getElementById("testPrinterBtn");
const statusBox = document.getElementById("printerStatus");

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#b42318" : "#5f7185";
}

function renderTransportFields() {
  const isCom = transportInput.value === "com";
  tcpFields.classList.toggle("hidden", isCom);
  comFields.classList.toggle("hidden", !isCom);
}

async function loadConfig() {
  const res = await fetch("/api/print/config");
  if (!res.ok) {
    const error = await readJsonSafe(res);
    throw new Error(error.error || "Не удалось загрузить настройки");
  }

  const cfg = await readJsonSafe(res);
  transportInput.value = cfg.transport || "tcp";
  hostInput.value = cfg.host || "";
  portInput.value = cfg.port || 9100;
  comPortInput.value = cfg.comPort || "COM3";
  comBaudInput.value = cfg.comBaudRate || 9600;
  charsInput.value = cfg.charsPerLine || 42;
  codePageInput.value = cfg.codePage ?? 17;
  renderTransportFields();
}

async function saveConfig() {
  saveBtn.disabled = true;
  setStatus("Сохранение...");
  try {
    const transport = transportInput.value;
    const payload = {
      transport,
      charsPerLine: Number(charsInput.value),
      codePage: Number(codePageInput.value)
    };

    if (transport === "tcp") {
      payload.host = hostInput.value.trim();
      payload.port = Number(portInput.value);
    } else {
      payload.comPort = comPortInput.value.trim().toUpperCase();
      payload.comBaudRate = Number(comBaudInput.value);
    }

    const res = await fetch("/api/print/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const error = await readJsonSafe(res);
      throw new Error(error.error || "Ошибка сохранения");
    }

    await loadConfig();
    setStatus("Настройки принтера сохранены в базе");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

async function testPrint() {
  testBtn.disabled = true;
  setStatus("Отправка тестовой печати...");
  try {
    const res = await fetch("/api/print/test", { method: "POST" });
    if (!res.ok) {
      const error = await readJsonSafe(res);
      throw new Error(error.error || "Тестовая печать не выполнена");
    }
    setStatus("Тестовая печать отправлена");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    testBtn.disabled = false;
  }
}

transportInput.addEventListener("change", renderTransportFields);
saveBtn.addEventListener("click", saveConfig);
testBtn.addEventListener("click", testPrint);

loadConfig().catch((err) => setStatus(err.message, true));
