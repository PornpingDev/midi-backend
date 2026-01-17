const db = require("../db/connection");


async function updateSalesOrderStatus(connection, sales_order_id) {
  // ยอดที่สั่งต่อ product
  const [orderItems] = await connection.query(
    `SELECT product_id, SUM(quantity) AS ordered_qty
     FROM sales_order_items
     WHERE sales_order_id = ? AND is_deleted = 0
     GROUP BY product_id`,
    [sales_order_id]
  );

  if (orderItems.length === 0) {
    await connection.query(
      "UPDATE sales_orders SET status = 'รอจอง' WHERE id = ?",
      [sales_order_id]
    );
    return;
  }

  // reserved ที่ยังค้างจริง
  const [resv] = await connection.query(
    `SELECT product_id, SUM(quantity_reserved) AS reserved_qty
     FROM stock_reservations
     WHERE sales_order_id = ? AND is_deleted = 0 AND status = 'จองแล้ว'
     GROUP BY product_id`,
    [sales_order_id]
  );

  // delivered รวม
  const [delv] = await connection.query(
    `SELECT di.product_id, SUM(di.quantity_delivered) AS delivered_qty
     FROM delivery_note_items di
     JOIN delivery_notes d ON d.id = di.delivery_note_id
     WHERE d.sales_order_id = ?
     GROUP BY di.product_id`,
    [sales_order_id]
  );

  const reservedMap  = new Map(resv.map(r => [r.product_id, Number(r.reserved_qty || 0)]));
  const deliveredMap = new Map(delv.map(r => [r.product_id, Number(r.delivered_qty || 0)]));

  let allFull = true;
  let anyReserved = false;

  for (const it of orderItems) {
    const ordered   = Number(it.ordered_qty || 0);
    const delivered = deliveredMap.get(it.product_id) || 0;
    const reserved  = reservedMap.get(it.product_id)  || 0;

    const remaining = Math.max(ordered - delivered, 0);
    if (reserved > 0) anyReserved = true;
    if (reserved < remaining) allFull = false;
  }

  let newStatus = "รอจอง";
  if (allFull) newStatus = "จองทั้งหมด";
  else if (anyReserved) newStatus = "จองบางส่วน";

  await connection.query(
    "UPDATE sales_orders SET status = ? WHERE id = ?",
    [newStatus, sales_order_id]
  );
}





//  POST /sales-order
exports.createSalesOrder = async (req, res) => {
  try {
    const {
      sales_order_no,
      customer_id,
      note,
      items,
      order_date,
      po_number,
      salesperson_name,
      order_channel,
      required_date,
    } = req.body;

    if (!sales_order_no || !customer_id || !items || items.length === 0) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    // ถ้าไม่มี order_date ให้ใช้วันที่ปัจจุบัน
    const finalOrderDate = order_date || new Date().toISOString().split("T")[0];


    // ตรวจสอบค่าที่ส่งเข้ามา (ถ้าไม่มีก็ให้เป็น null)
    const finalRequiredDate = required_date || null;


    // 1. Insert into sales_orders (เพิ่ม 2 ฟิลด์ใหม่แบบ optional)
    const [soResult] = await db.query(
      `INSERT INTO sales_orders 
        (sales_order_no, customer_id, order_date, required_date, po_number, note, salesperson_name, order_channel) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sales_order_no,
        customer_id,
        finalOrderDate,
        finalRequiredDate,
        po_number || null,
        note,
        salesperson_name || null,
        order_channel || null,
      ]
    );

    const sales_order_id = soResult.insertId;

    // 2. Insert into sales_order_items
    for (const item of items) {
      await db.query(
        "INSERT INTO sales_order_items (sales_order_id, product_id, quantity) VALUES (?, ?, ?)",
        [sales_order_id, item.product_id, item.quantity]
      );
    }

    res.json({ message: "✅ Sales Order created successfully" });
  } catch (err) {
    console.error("❌ createSalesOrder error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


//  GET /sales-orders
exports.getAllSalesOrders = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        so.id, 
        so.sales_order_no, 
        so.order_date,
        so.required_date,
        so.po_number, 
        so.note, 
        so.created_at, 
        so.status, 
        c.name AS customer_name,
        so.salesperson_name,
        so.order_channel,
        (
          SELECT MAX(dn.delivery_date)
          FROM delivery_notes dn
          WHERE dn.sales_order_id = so.id
        ) AS last_delivery_date
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      ORDER BY so.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ getAllSalesOrders error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

//  GET /sales-order/:id/items
exports.getSalesOrderItems = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT i.id, i.product_id, p.name AS product_name, i.quantity
      FROM sales_order_items i
      JOIN products p ON i.product_id = p.id
      WHERE i.sales_order_id = ? AND i.is_deleted = 0
    `, [req.params.id]);

    res.json(rows);
  } catch (err) {
    console.error("❌ getSalesOrderItems error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


/* อันนี้ของเก่า
// DELETE /sales-orders/:id
exports.deleteSalesOrder = async (req, res) => {
  const connection = await db.getConnection();
  const soId = req.params.id;

  try {
    await connection.beginTransaction();

    // 🔁 1. ดึงรายการสินค้าที่ถูกจองไว้ใน sales_order_items
    const [items] = await connection.query(
      `SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = ?`,
      [soId]
    );

    // 🔁 2. คืน stock ที่จอง (ลด reserved)
    for (const item of items) {
      await connection.query(
        `UPDATE products SET reserved = GREATEST(reserved - ?, 0) WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    // 🗑️ 3. ลบรายการจอง
    await connection.query(`DELETE FROM sales_order_items WHERE sales_order_id = ?`, [soId]);

    // 🗑️ 4. ลบ sales_order
    await connection.query(`DELETE FROM sales_orders WHERE id = ?`, [soId]);

    await connection.commit();
    res.json({ message: "✅ ลบคำสั่งขายและคืน stock สำเร็จ" });
  } catch (err) {
    await connection.rollback();
    console.error("❌ ลบคำสั่งขายล้มเหลว:", err);
    res.status(500).json({ message: "❌ ลบคำสั่งขายไม่สำเร็จ" });
  } finally {
    connection.release();
  }
};

*/

// ยกเลิกการจองผ่านตาราง stock_reservations เท่านั้น” เพื่อให้ Trigger ทำงานลด products.reserved ให้อัตโนมัติ
// DELETE /sales-orders/:id
exports.deleteSalesOrder = async (req, res) => {
  const connection = await db.getConnection();
  const soId = Number(req.params.id);

  if (!soId) {
    return res.status(400).json({ message: "SO id ไม่ถูกต้อง" });
  }

  try {
    await connection.beginTransaction();

    // 0) กันลบ SO ถ้ามีเอกสารส่งของแล้ว (DN ใด ๆ ของ SO นี้)
    const [[dnChk]] = await connection.query(
      `SELECT COUNT(*) AS cnt FROM delivery_notes WHERE sales_order_id = ?`,
      [soId]
    );
    if (Number(dnChk.cnt) > 0) {
      throw new Error("ลบไม่ได้: มีเอกสารส่งของ (Delivery Note) แล้ว");
    }

    // 1) ยกเลิกการจองที่ยังค้างอยู่ของ SO นี้ (ให้ Trigger ไปลด products.reserved เอง)
    await connection.query(
      `UPDATE stock_reservations
         SET is_deleted = 1, updated_at = NOW()
       WHERE sales_order_id = ?
         AND is_deleted = 0
         AND status = 'จองแล้ว'`,
      [soId]
    );
    // หมายเหตุ: ทริกเกอร์ trg_reservations_after_update_cancel จะลด products.reserved ตาม OLD.quantity_reserved ให้เอง

    // 2) ลบรายการ SO items
    await connection.query(
      `DELETE FROM sales_order_items WHERE sales_order_id = ?`,
      [soId]
    );

    // 3) ลบหัว SO
    await connection.query(
      `DELETE FROM sales_orders WHERE id = ?`,
      [soId]
    );

    await connection.commit();
    res.json({ message: "✅ ลบคำสั่งขายและยกเลิกการจองสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    console.error("❌ ลบคำสั่งขายล้มเหลว:", err);
    res.status(400).json({ message: err.message || "❌ ลบคำสั่งขายไม่สำเร็จ" });
  } finally {
    connection.release();
  }
};





// GET /sales-orders/:id/items-summary
exports.getItemsSummary = async (req, res) => {
  const soId = Number(req.params.id);
  if (!soId) {
    return res.status(400).json({ message: "ต้องระบุ sales order id ที่ถูกต้อง" });
  }

  try {
    // 1) ดึงยอดที่สั่ง (Ordered) ต่อ product ของ SO ใบนี้
    const [orderedRows] = await db.query(
      `SELECT soi.product_id, SUM(soi.quantity) AS ordered
       FROM sales_order_items soi
       WHERE soi.sales_order_id = ?
          AND soi.is_deleted = 0
       GROUP BY soi.product_id`,
      [soId]
    );

    // ไม่มีสินค้าใน SO นี้
    if (orderedRows.length === 0) {
      return res.json([]);
    }

    const productIds = orderedRows.map(r => r.product_id);

    // 2) ดึงยอดจองที่ยังคงอยู่ (Reserved รวม) ของ SO ใบนี้
    const [reservedRows] = await db.query(
      `SELECT sr.product_id, SUM(sr.quantity_reserved) AS reserved_total
       FROM stock_reservations sr
       WHERE sr.sales_order_id = ?
         AND sr.is_deleted = 0
         AND sr.status = 'จองแล้ว'
         AND sr.product_id IN (${productIds.map(() => "?").join(",")})
       GROUP BY sr.product_id`,
      [soId, ...productIds]
    );

    // 3) ดึงยอดส่งจริงทั้งหมด (Delivered รวม) ของ SO ใบนี้
    const [deliveredRows] = await db.query(
      `SELECT di.product_id, SUM(di.quantity_delivered) AS delivered_total
       FROM delivery_note_items di
       JOIN delivery_notes d ON d.id = di.delivery_note_id
       WHERE d.sales_order_id = ?
         AND di.product_id IN (${productIds.map(() => "?").join(",")})
       GROUP BY di.product_id`,
      [soId, ...productIds]
    );

    // 4) ดึงข้อมูลสินค้า (product_no, name, available)
    const [productRows] = await db.query(
      `SELECT p.id AS product_id, p.product_no, p.name, p.available
       FROM products p
       WHERE p.id IN (${productIds.map(() => "?").join(",")})
         AND p.is_deleted = 0`,
      productIds
    );

    // ทำเป็น Map ไว้รวมทีหลังง่าย ๆ
    const orderedMap = new Map();
    orderedRows.forEach(r => orderedMap.set(r.product_id, Number(r.ordered) || 0));

    const reservedMap = new Map();
    reservedRows.forEach(r => reservedMap.set(r.product_id, Number(r.reserved_total) || 0));

    const deliveredMap = new Map();
    deliveredRows.forEach(r => deliveredMap.set(r.product_id, Number(r.delivered_total) || 0));

    const productMap = new Map();
    productRows.forEach(p => {
      productMap.set(p.product_id, {
        product_no: p.product_no,
        name: p.name,
        available: Number(p.available) || 0,
      });
    });

    // รวมผลลัพธ์สุดท้ายต่อ product
    const result = orderedRows.map(r => {
      const pid = r.product_id;
      const ordered = Number(r.ordered) || 0;
      const reserved_total = reservedMap.get(pid) || 0;
      const delivered_total = deliveredMap.get(pid) || 0;
      const remainingRaw = ordered - delivered_total;
      const remaining = remainingRaw > 0 ? remainingRaw : 0;

      const info = productMap.get(pid) || { product_no: null, name: null, available: 0 };

      return {
        product_id: pid,
        product_no: info.product_no,
        name: info.name,
        ordered,
        reserved_total,
        delivered_total,
        remaining,
        available: info.available,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("getItemsSummary error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลสรุป" });
  }
};


// POST /sales-orders/:id/items
exports.addSalesOrderItem = async (req, res) => {
  const soId = Number(req.params.id);
  const { product_id, quantity } = req.body;

  if (!soId || !product_id || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบ: ต้องมี product_id และ quantity > 0" });
  }

  try {
    await db.query(
      "INSERT INTO sales_order_items (sales_order_id, product_id, quantity) VALUES (?, ?, ?)",
      [soId, product_id, Number(quantity)]
    );
    res.json({ message: "เพิ่มรายการใน SO สำเร็จ" });
  } catch (err) {
    console.error("addSalesOrderItem error:", err);
    res.status(500).json({ message: "เพิ่มรายการไม่สำเร็จ" });
  }
};



exports.softDeleteOrderItemByProduct = async (req, res) => {
  const connection = await db.getConnection();
  const soId = Number(req.params.soId);
  const productId = Number(req.params.productId);

  if (!soId || !productId) {
    return res.status(400).json({ message: "ต้องระบุ soId และ productId" });
  }

  try {
    await connection.beginTransaction();

    // 1) ตรวจว่ามีรายการอยู่และยังไม่ถูกลบ
    const [[item]] = await connection.query(
      `SELECT id, quantity
       FROM sales_order_items
       WHERE sales_order_id = ? AND product_id = ? AND is_deleted = 0
       FOR UPDATE`,
      [soId, productId]
    );
    if (!item) throw new Error("ไม่พบรายการขายนี้ หรือถูกลบไปแล้ว");

    // 2) ห้ามลบถ้ายังมีจองค้าง
    const [[rsv]] = await connection.query(
      `SELECT COUNT(*) AS cnt
       FROM stock_reservations
       WHERE sales_order_id = ? AND product_id = ? AND is_deleted = 0 AND status = 'จองแล้ว'`,
      [soId, productId]
    );
    if (Number(rsv.cnt) > 0) {
      throw new Error("ไม่สามารถลบได้: มีการจองค้างอยู่ กรุณายกเลิกการจองก่อน");
    }

    // 3) ห้ามลบถ้ามีส่งของแล้ว
    const [[delv]] = await connection.query(
      `SELECT COALESCE(SUM(di.quantity_delivered),0) AS delivered
       FROM delivery_note_items di
       JOIN delivery_notes d ON d.id = di.delivery_note_id
       WHERE d.sales_order_id = ? AND di.product_id = ?`,
      [soId, productId]
    );
    if (Number(delv.delivered) > 0) {
      throw new Error("ไม่สามารถลบได้: มีการส่งของแล้ว");
    }

    // 4) Soft delete
    await connection.query(
      `UPDATE sales_order_items
       SET is_deleted = 1, updated_at = NOW()
       WHERE sales_order_id = ? AND product_id = ?`,
      [soId, productId]
    );

    // 5) อัปเดตสถานะ SO
    await updateSalesOrderStatus(connection, soId);

    await connection.commit();
    res.json({ message: "ลบรายการขายสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message || "ลบไม่สำเร็จ" });
  } finally {
    connection.release();
  }
};




exports.getForDeliveryPreview = async (req, res) => {
  const soId = Number(req.params.id || 0);
  if (!soId) return res.status(400).json({ message: 'SO id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    // หัว SO
    const [[so]] = await conn.query(
      `SELECT id, sales_order_no, order_date, status
       FROM sales_orders
       WHERE id=?`, [soId]
    );
    if (!so) return res.status(404).json({ message: 'ไม่พบ SO' });

    // รายการ SO + ค่าคำนวณ (reserved_left, delivered, remaining, available)
    const [items] = await conn.query(`
      SELECT
        soi.id                         AS sales_order_item_id,
        soi.product_id,
        p.product_no,
        p.name                         AS product_name,
        soi.quantity                   AS ordered,
        p.stock,
        p.reserved,
        p.available,
        COALESCE(d.delivered, 0)       AS delivered,
        GREATEST(soi.quantity - COALESCE(d.delivered,0), 0) AS remaining,
        LEAST(
          COALESCE(r.reserved_left,0),
          GREATEST(soi.quantity - COALESCE(d.delivered,0), 0)
        )                               AS reserved_left
      FROM sales_order_items soi
      JOIN products p ON p.id = soi.product_id
      LEFT JOIN (
        SELECT sales_order_id, product_id, SUM(quantity_reserved) AS reserved_left
        FROM stock_reservations
        WHERE status='จองแล้ว' AND is_deleted=0
              AND (used_in_dn_id IS NULL OR used_in_dn_id=0)
        GROUP BY sales_order_id, product_id
      ) r ON r.sales_order_id = soi.sales_order_id AND r.product_id = soi.product_id
      LEFT JOIN (
        SELECT sales_order_item_id, SUM(quantity_delivered) AS delivered
        FROM delivery_note_items
        GROUP BY sales_order_item_id
      ) d ON d.sales_order_item_id = soi.id
      WHERE soi.sales_order_id = ? AND soi.is_deleted = 0
      ORDER BY soi.id ASC
    `, [soId]);

    // รูปแบบตอบกลับที่ FE ใช้งานง่าย
    res.json({
      ok: true,
      sales_order: {
        id: so.id,
        sales_order_no: so.sales_order_no,
        order_date: so.order_date,
        status: so.status
      },
      items: items.map(r => ({
        id: r.sales_order_item_id,
        product_id: r.product_id,
        product_no: r.product_no,
        product_name: r.product_name,
        ordered: Number(r.ordered),
        reserved: Number(r.reserved),
        delivered: Number(r.delivered),
        remaining: Number(r.remaining),
        reserved_left: Number(r.reserved_left),
        stock: Number(r.stock),
        available: Number(r.available)
      })),
      // ช่วยสรุปในโมดอล
      summary: {
        selectable_lines: items.filter(r => r.reserved_left > 0).length,
        total_reserved_left: items.reduce((s, r) => s + Number(r.reserved_left || 0), 0)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  } finally {
    conn.release();
  }
};