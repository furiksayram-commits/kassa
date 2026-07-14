const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "kassa.db");
const clientId = 213;

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Ошибка подключения к БД:", err.message);
    process.exit(1);
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
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

async function deleteAllClientData() {
  try {
    console.log(`🔍 ПОЛНАЯ ОЧИСТКА клиента ID ${clientId}...\n`);

    // Начинаем транзакцию
    await run("BEGIN IMMEDIATE TRANSACTION");

    let totalDeleted = {
      payments: 0,
      syncRecords: 0,
      outboxOps: 0,
      salesItems: 0,
      sales: 0
    };

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
      totalDeleted.syncRecords = syncRecords.length;
      console.log(`✓ Удалено записей синхронизации: ${syncRecords.length}`);
    }

    // 2. Удаляем задачи синхронизации в очереди
    const outboxOps = await all(
      "SELECT id FROM debt_sync_outbox WHERE client_id = ?",
      [clientId]
    );
    if (outboxOps.length > 0) {
      await run("DELETE FROM debt_sync_outbox WHERE client_id = ?", [clientId]);
      totalDeleted.outboxOps = outboxOps.length;
      console.log(`✓ Удалено задач в очереди синхронизации: ${outboxOps.length}`);
    }

    // 3. Удаляем платежи (debt_payments)
    const payments = await all(
      "SELECT id FROM debt_payments WHERE client_id = ?",
      [clientId]
    );
    if (payments.length > 0) {
      // Сначала удаляем ссылки на платежи в debt_sync_records
      const paymentIds = payments.map(p => p.id);
      await run(
        `DELETE FROM debt_sync_records WHERE local_payment_id IN (${paymentIds.map(() => '?').join(',')})`,
        paymentIds
      );
      
      // Теперь удаляем сами платежи
      await run("DELETE FROM debt_payments WHERE client_id = ?", [clientId]);
      totalDeleted.payments = payments.length;
      console.log(`✓ Удалено платежей/взносов: ${payments.length}`);
    }

    // 4. Находим все продажи (счета) клиента и их позиции
    const sales = await all(
      "SELECT id, sale_code FROM sales WHERE client_id = ?",
      [clientId]
    );
    
    if (sales.length > 0) {
      console.log(`\n📦 Удаляем ${sales.length} счетов клиента...`);
      
      for (const sale of sales) {
        // Удаляем позиции в счете
        const itemsResult = await run(
          "DELETE FROM sale_items WHERE sale_id = ?",
          [sale.id]
        );
        totalDeleted.salesItems += itemsResult.changes;

        // Удаляем ссылки на продажу в debt_sync_records
        await run(
          "DELETE FROM debt_sync_records WHERE local_sale_id = ?",
          [sale.id]
        );

        // Удаляем платежи, привязанные к этому счету
        await run(
          "DELETE FROM debt_payments WHERE sale_id = ?",
          [sale.id]
        );
      }

      // Удаляем сами счета
      const saleIds = sales.map(s => s.id);
      const salesResult = await run(
        `DELETE FROM sales WHERE id IN (${saleIds.map(() => '?').join(',')})`,
        saleIds
      );
      totalDeleted.sales = salesResult.changes;
      console.log(`✓ Удалено счетов: ${sales.length}`);
      console.log(`✓ Удалено позиций в счетах: ${totalDeleted.salesItems}`);
    }

    // Коммитим транзакцию
    await run("COMMIT");

    console.log("\n" + "=".repeat(50));
    console.log("✅ ПОЛНАЯ ОЧИСТКА УСПЕШНО ЗАВЕРШЕНА!");
    console.log("=".repeat(50));
    console.log("\n📊 Статистика удаления:");
    console.log(`   • Платежи/взносы: ${totalDeleted.payments}`);
    console.log(`   • Счета: ${totalDeleted.sales}`);
    console.log(`   • Позиции в счетах: ${totalDeleted.salesItems}`);
    console.log(`   • Записи синхронизации: ${totalDeleted.syncRecords}`);
    console.log(`   • Задачи в очереди: ${totalDeleted.outboxOps}`);
    console.log(`\n🗑️  ВСЕГО УДАЛЕНО: ${
      totalDeleted.payments + 
      totalDeleted.sales + 
      totalDeleted.salesItems + 
      totalDeleted.syncRecords + 
      totalDeleted.outboxOps
    } записей\n`);

    console.log("💡 Клиент полностью очищен от долгов и операций!");

  } catch (err) {
    console.error("\n❌ Ошибка при удалении:", err.message);
    try {
      await run("ROLLBACK");
    } catch (_) {}
    process.exit(1);
  } finally {
    db.close();
  }
}

deleteAllClientData();
