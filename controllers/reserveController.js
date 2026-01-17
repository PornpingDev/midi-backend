const db = require("../db/connection");

async function updateSalesOrderStatus(connection, sales_order_id) {
  const [orderItems] = await connection.query(
    `SELECT product_id, SUM(quantity) AS ordered_qty
     FROM sales_order_items
     WHERE sales_order_id = ?
     GROUP BY product_id`,
    [sales_order_id]
  );

  if (orderItems.length === 0) {
    await connection.query("UPDATE sales_orders SET status = 'รอจอง' WHERE id = ?", [sales_order_id]);
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

  // delivered รวมของ SO
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

  await connection.query("UPDATE sales_orders SET status = ? WHERE id = ?", [newStatus, sales_order_id]);
}



// เดิม: bulk reserve (sales_order_id + items[])
exports.reserveStock = async (req, res) => {
  const connection = await db.getConnection();
  const { sales_order_id, items } = req.body;

  if (!sales_order_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    await connection.beginTransaction();

    for (const item of items) {
      const { product_id, quantity } = item;

      // 1) ordered ใน SO สำหรับสินค้านี้
      const [[ord]] = await connection.query(
       `SELECT COALESCE(SUM(quantity),0) AS ordered
        FROM sales_order_items
        WHERE sales_order_id = ? AND product_id = ?`,
       [sales_order_id, product_id]
      );
      const ordered = Number(ord?.ordered || 0);
      if (ordered <= 0) throw new Error("SO ไม่มีสินค้านี้");
     
      // 2) delivered รวม
      const [[delv]] = await connection.query(
        `SELECT COALESCE(SUM(di.quantity_delivered),0) AS delivered
         FROM delivery_note_items di
         JOIN delivery_notes d ON d.id = di.delivery_note_id
         WHERE d.sales_order_id = ? AND di.product_id = ?`,
        [sales_order_id, product_id]
      );
      const delivered = Number(delv?.delivered || 0);
     
      // 3) reserved ค้าง
      const [[resv]] = await connection.query(
        `SELECT COALESCE(SUM(quantity_reserved),0) AS reserved_total
         FROM stock_reservations
         WHERE sales_order_id = ? AND product_id = ? AND is_deleted = 0 AND status='จองแล้ว'`,
        [sales_order_id, product_id]
      );
      const reservedTotal = Number(resv?.reserved_total || 0);
     
      // 4) remaining และ remaining ที่ยังไม่ถูกจอง
      const remaining = Math.max(ordered - delivered, 0);
      const remainingNotYetReserved = Math.max(remaining - reservedTotal, 0);
     
      // 5) available ปัจจุบัน
      const [[prod]] = await connection.query(
        `SELECT (stock - reserved) AS available
         FROM products WHERE id = ? AND is_deleted = 0`,
        [product_id]
      );
      if (!prod) throw new Error("ไม่พบสินค้า");
      const available = Number(prod.available || 0);
     
      // 6) ตรวจอินพุต
      const q = Number(quantity);
      if (q <= 0) throw new Error("จำนวนต้องมากกว่า 0");
      if (q > remainingNotYetReserved) throw new Error(`จำนวนจองเกิน Remaining ที่ยังไม่ได้จอง (${remainingNotYetReserved})`);
      if (q > available) throw new Error(`จำนวนจองเกิน Available ปัจจุบัน (${available})`);
      
      // 7) INSERT แถวจอง (ปล่อยให้ Trigger AFTER INSERT เพิ่ม reserved)
      await connection.query(
        `INSERT INTO stock_reservations
         (sales_order_id, product_id, quantity_reserved, status, is_deleted, created_at)
         VALUES (?, ?, ?, 'จองแล้ว', 0, NOW())`,
        [sales_order_id, product_id, quantity]
      );
      // หมายเหตุ: reserved จะเพิ่มจาก TRIGGER AFTER INSERT
    }

    await updateSalesOrderStatus(connection, sales_order_id);
    await connection.commit();

    res.json({ message: "จองสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
};


/*
// ใหม่: จองทีละรายการ
exports.reserveItem = async (req, res) => {
  const connection = await db.getConnection();
  const { sales_order_id, product_id, quantity } = req.body;

  if (!sales_order_id || !product_id || !quantity) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    await connection.beginTransaction();

    // เช็คสินค้า + available
    const [[prod]] = await connection.query(
      "SELECT id, stock, reserved FROM products WHERE id = ? AND is_deleted = 0",
      [product_id]
    );
    if (!prod) throw new Error("ไม่พบสินค้า");

    const available = Number(prod.stock) - Number(prod.reserved);
    if (quantity <= 0 || quantity > available) {
      throw new Error(`จำนวนจองเกิน (${available})`);
    }

    // ไม่ให้มีแถวซ้ำ
    const [[dup]] = await connection.query(
      `SELECT id FROM stock_reservations 
       WHERE sales_order_id = ? AND product_id = ? AND is_deleted = 0`,
      [sales_order_id, product_id]
    );
    if (dup) throw new Error("มีรายการจองสินค้านี้อยู่แล้ว");

    await connection.query(
      `INSERT INTO stock_reservations
       (sales_order_id, product_id, quantity_reserved, status, is_deleted, created_at)
       VALUES (?, ?, ?, 'จองแล้ว', 0, NOW())`,
      [sales_order_id, product_id, quantity]
    );

    await updateSalesOrderStatus(connection, sales_order_id);
    await connection.commit();
    res.json({ message: "จองรายการนี้สำเร็จ" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
};

*/

// ใหม่: จองทีละรายการ (ปลอดภัยขึ้น)
exports.reserveItem = async (req, res) => {
  const connection = await db.getConnection();
  const { sales_order_id, product_id, quantity } = req.body;

  // validate input ต้นทาง
  const q = Number(quantity);
  if (!sales_order_id || !product_id || !q || q <= 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วนหรือจำนวนไม่ถูกต้อง" });
  }

  try {
    await connection.beginTransaction();

    // 1) เช็คสินค้า + available ปัจจุบัน
    const [[prod]] = await connection.query(
      "SELECT id, stock, reserved FROM products WHERE id = ? AND is_deleted = 0",
      [product_id]
    );
    if (!prod) throw new Error("ไม่พบสินค้า");
    const available = Number(prod.stock) - Number(prod.reserved);

    // 2) คำนวณสิทธิ์จองตาม SO (ordered - delivered - reserved ที่ยังค้าง)
    const [[ord]] = await connection.query(
      `SELECT COALESCE(SUM(quantity),0) AS ordered
       FROM sales_order_items
       WHERE sales_order_id = ? AND product_id = ?`,
      [sales_order_id, product_id]
    );
    const [[delv]] = await connection.query(
      `SELECT COALESCE(SUM(di.quantity_delivered),0) AS delivered
       FROM delivery_note_items di
       JOIN delivery_notes d ON d.id = di.delivery_note_id
       WHERE d.sales_order_id = ? AND di.product_id = ?`,
      [sales_order_id, product_id]
    );
    const [[resv]] = await connection.query(
      `SELECT COALESCE(SUM(quantity_reserved),0) AS reserved_total
       FROM stock_reservations
       WHERE sales_order_id = ? AND product_id = ?
         AND is_deleted = 0 AND status = 'จองแล้ว'`,
      [sales_order_id, product_id]
    );

    const ordered = Number(ord?.ordered || 0);
    const delivered = Number(delv?.delivered || 0);
    const reservedTotal = Number(resv?.reserved_total || 0);

    const remaining = Math.max(ordered - delivered, 0);
    const remainingNotYetReserved = Math.max(remaining - reservedTotal, 0);

    // 3) ตรวจสิทธิ์: ห้ามเกินทั้ง remainingNotYetReserved และ available
    if (q > remainingNotYetReserved) {
      throw new Error(`จำนวนจองเกิน Remaining ที่ยังไม่ได้จอง (${remainingNotYetReserved})`);
    }
    if (q > available) {
      throw new Error(`จำนวนจองเกิน Available ปัจจุบัน (${available})`);
    }

    // 4) กันแถวซ้ำ (ระบบออกแบบให้ 1 SO ต่อสินค้า มีได้ 1 แถวจอง)
    const [[dup]] = await connection.query(
      `SELECT id FROM stock_reservations
       WHERE sales_order_id = ? AND product_id = ?
         AND is_deleted = 0 AND status = 'จองแล้ว'`,
      [sales_order_id, product_id]
    );
    if (dup) throw new Error("มีรายการจองสินค้านี้อยู่แล้ว กรุณาใช้ 'แก้ไข' แทน");

    // 5) INSERT — Trigger AFTER INSERT จะไปเพิ่ม products.reserved ให้เอง
    await connection.query(
      `INSERT INTO stock_reservations
       (sales_order_id, product_id, quantity_reserved, status, is_deleted, created_at)
       VALUES (?, ?, ?, 'จองแล้ว', 0, NOW())`,
      [sales_order_id, product_id, q]
    );

    // 6) อัปเดตสถานะ SO (รอจอง/จองบางส่วน/จองทั้งหมด)
    await updateSalesOrderStatus(connection, sales_order_id);

    await connection.commit();
    return res.json({ message: "จองรายการนี้สำเร็จ" });
  } catch (err) {
    await connection.rollback();
    return res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
};





// ใหม่: แก้ไขจำนวนที่จอง (คำนวณ delta เอง เพราะเราไม่ได้ทำ trigger กรณีแก้จำนวน)
exports.updateReservation = async (req, res) => {
  const connection = await db.getConnection();
  const id = req.params.id;
  const { quantity } = req.body;

  if (!id || !quantity || quantity <= 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    await connection.beginTransaction();

    const [[row]] = await connection.query(
       `SELECT r.id, r.sales_order_id, r.product_id, r.quantity_reserved, r.is_deleted, r.status,
               p.stock, p.reserved, (p.stock - p.reserved) AS available
        FROM stock_reservations r
        JOIN products p ON p.id = r.product_id
        WHERE r.id = ? AND r.is_deleted = 0 AND r.status = 'จองแล้ว'
        FOR UPDATE`,
       [id],
    );
    if (!row) throw new Error("ไม่พบรายการจองที่แก้ไขได้");

    const oldQty = Number(row.quantity_reserved);
    const newQty = Number(quantity);
    const delta  = newQty - oldQty;

    if (delta > 0) {
      // เช็ค remainingNotYetReserved และ available
        const [[ord]] = await connection.query(
          `SELECT COALESCE(SUM(quantity),0) AS ordered
           FROM sales_order_items WHERE sales_order_id = ? AND product_id = ?`,
          [row.sales_order_id, row.product_id]
        );
        const [[delv]] = await connection.query(
          `SELECT COALESCE(SUM(di.quantity_delivered),0) AS delivered
           FROM delivery_note_items di
           JOIN delivery_notes d ON d.id = di.delivery_note_id
           WHERE d.sales_order_id = ? AND di.product_id = ?`,
          [row.sales_order_id, row.product_id]
        );
        const [[resv]] = await connection.query(
          `SELECT COALESCE(SUM(quantity_reserved),0) AS reserved_total
           FROM stock_reservations
           WHERE sales_order_id = ? AND product_id = ? AND is_deleted = 0 AND status='จองแล้ว'`,
          [row.sales_order_id, row.product_id]
        );
        const ordered = Number(ord?.ordered || 0);
        const delivered = Number(delv?.delivered || 0);
        const reservedTotal = Number(resv?.reserved_total || 0);
        const remaining = Math.max(ordered - delivered, 0);
        const remainingNotYetReserved = Math.max(remaining - reservedTotal, 0);
        const available = Number(row.available || 0);

        if (delta > remainingNotYetReserved) throw new Error(`จำนวนเพิ่ม (${delta}) เกิน Remaining ที่ยังไม่ได้จอง (${remainingNotYetReserved})`);
        if (delta > available)                  throw new Error(`จำนวนเพิ่ม (${delta}) เกิน Available ปัจจุบัน (${available})`);
    
      


      // เพิ่ม reserved สินค้า (เราเลือกอัปเดตเอง ไม่ใช้ trigger)
      await connection.query(
        "UPDATE products SET reserved = reserved + ? WHERE id = ?",
        [delta, row.product_id]
      );

      

    } else if (delta < 0) {
      // ลด reserved สินค้า
      await connection.query(
        "UPDATE products SET reserved = reserved + ? WHERE id = ?",
        [delta, row.product_id] // delta เป็นลบ
      );
    }

    await connection.query(
      `UPDATE stock_reservations 
       SET quantity_reserved = ?, updated_at = NOW()
       WHERE id = ?`,
      [quantity, id]
    );

    await updateSalesOrderStatus(connection, row.sales_order_id);
    await connection.commit();
    res.json({ message: "แก้ไขจำนวนจองสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
};

// ใหม่: ยกเลิกจอง (soft delete) → Trigger จะคืน reserved ให้อัตโนมัติ (AFTER UPDATE is_deleted=1)
exports.cancelReservation = async (req, res) => {
  const connection = await db.getConnection();
  const id = Number(req.params.id);

  if (!id) return res.status(400).json({ message: "ต้องระบุ id" });

  try {
    await connection.beginTransaction();

    // ดึงแถวเดิม + lock
    const [[row]] = await connection.query(
      `SELECT r.id, r.sales_order_id, r.product_id, r.quantity_reserved, r.is_deleted, r.status
       FROM stock_reservations r
       WHERE r.id = ? AND r.is_deleted = 0 AND r.status = 'จองแล้ว'
       FOR UPDATE`,
      [id] // << ที่เดิมหาย comma ตรงนี้แหละ
    );
    if (!row) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบรายการจองที่ยกเลิกได้" });
    }

    // ตั้งยกเลิก (soft delete)
    await connection.query(
      `UPDATE stock_reservations
       SET is_deleted = 1, status = 'ยกเลิก', updated_at = NOW()
       WHERE id = ?`,
      [id]
    );

/*
    // คืน products.reserved ตามจำนวนเดิม
    await connection.query(
      `UPDATE products
       SET reserved = GREATEST(reserved - ?, 0)
       WHERE id = ?`,
      [Number(row.quantity_reserved), Number(row.product_id)]
    );

*/

    await connection.commit();

    // อัปเดตสถานะ SO หลังยกเลิก (นอกรูปแบบ transaction)
    await updateSalesOrderStatus(connection, row.sales_order_id);

    return res.json({ message: "ยกเลิกการจองสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    console.error("cancelReservation error:", err);
    return res.status(500).json({ message: "ยกเลิกไม่สำเร็จ" });
  } finally {
    connection.release();
  }
};


// ใหม่: ดึงรายการจองของ SO
exports.getReservationsBySalesOrderId = async (req, res) => {
  const sales_order_id = req.params.sales_order_id || req.query.sales_order_id;
  if (!sales_order_id) return res.status(400).json({ message: "ต้องระบุ sales_order_id" });

  try {
    const [rows] = await db.query(
      `SELECT r.id, r.product_id, r.quantity_reserved, r.status, r.created_at, r.updated_at,
              p.product_no, p.name AS product_name, p.stock, p.reserved,
              (p.stock - p.reserved) AS available
       FROM stock_reservations r
       JOIN products p ON p.id = r.product_id
       WHERE r.sales_order_id = ? AND r.is_deleted = 0
       ORDER BY r.id DESC`,
      [sales_order_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
