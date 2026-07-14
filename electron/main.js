const { app, BrowserWindow, dialog } = require("electron");
const http = require("http");
const path = require("path");

const APP_URL = "http://127.0.0.1:3001";
const HEALTH_URL = `${APP_URL}/api/health`;
const SERVER_ENTRY = path.join(__dirname, "..", "server.js");

let mainWindow = null;

// Improves responsiveness on Windows terminals/POS PCs.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

function pingHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1000 }, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      resolve(ok);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(maxMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const ok = await pingHealth();
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function enableWindowsAutoStart() {
  if (process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);

  const serverReady = await waitForServer();
  if (!serverReady) {
    dialog.showErrorBox(
      "Ошибка запуска кассы",
      "Не удалось запустить локальный сервер кассы на http://127.0.0.1:3000"
    );
    app.quit();
    return;
  }

  await mainWindow.loadURL(APP_URL);
  mainWindow.show();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // Store writable DB/files in application directory (Program Files/MerosKassa)
    // Instead of AppData, keep everything in one place for portability
    const appDir = path.dirname(app.getAppPath());
    process.env.KASSA_DATA_DIR = path.join(appDir, "data");
    require(SERVER_ENTRY);
    enableWindowsAutoStart();
    await createWindow();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
