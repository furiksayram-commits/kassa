const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("data/kassa.db");

const clientId = 218;

db.all("SELECT id, sale_code, total FROM sales WHERE client_id = ?", [clientId], (err, sales) => {
  if (err) {
    console.error("Ошибка:", err);
    db.close();
    return;
  }
  
  if (!sales || sales.length === 0) {
    console.log("✅ Счетов не найдено - клиент чист!");
  } else {
    console.log(`⚠️  Найдено ${sales.length} счетов:`);
    sales.forEach(s => {
      console.log(`  • ${s.sale_code} - ${s.total} сом`);
    });
  }
  
  db.close();
});
