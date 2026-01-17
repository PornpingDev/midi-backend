const db = require('../db/connection'); // ปรับ path ให้ตรงโปรเจกต์

// จองเลขคู่ MDN/MINV ตามปีไทย (YY) + รันนัมเบอร์ 3 หลัก
async function allocatePair(conn) {
  const yy = String(new Date().getFullYear() + 543).slice(-2);
  const [rows] = await conn.query(
    "SELECT sequence FROM doc_pairs WHERE year_yy=? ORDER BY sequence DESC LIMIT 1 FOR UPDATE",
    [yy]
  );
  const nextSeq = rows.length ? rows[0].sequence + 1 : 1;
  await conn.query("INSERT INTO doc_pairs(year_yy,sequence) VALUES(?,?)", [yy, nextSeq]);
  const pad = String(nextSeq).padStart(3, '0');
  return { pair_id: (await conn.query("SELECT LAST_INSERT_ID() AS id"))[0][0].id,
           dn_no: `MDN${yy}-${pad}`, inv_no: `MINV${yy}-${pad}` };
}

// รวม delivered ต่อแถว (คำนวณจาก DN items)
async function deliveredMap(conn, soId) {
  const [rows] = await conn.query(`
    SELECT soi.id AS so_item_id, COALESCE(SUM(dni.quantity_delivered),0) AS delivered
    FROM sales_order_items soi
    LEFT JOIN delivery_note_items dni ON dni.sales_order_item_id = soi.id
    LEFT JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
    WHERE soi.sales_order_id = ?
    GROUP BY soi.id
  `, [soId]);
  const map = new Map();
  rows.forEach(r => map.set(r.so_item_id, Number(r.delivered || 0)));
  return map;
}

exports.sendNow = async (req, res) => {
  const { sales_order_id, item_ids } = req.body;
  if (!sales_order_id || !Array.isArray(item_ids) || item_ids.length === 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ล็อกหัว SO (กันชน)
    const [[so]] = await conn.query(
      "SELECT id, sales_order_no, customer_id FROM sales_orders WHERE id=? FOR UPDATE",
      [sales_order_id]
    );
    if (!so) throw new Error("ไม่พบ SO");

    // เตรียม delivered map ก่อนส่ง
    const beforeDelivered = await deliveredMap(conn, sales_order_id);

    // จองเลขเอกสารคู่
    const pair = await allocatePair(conn);

    // สร้างหัว DN (ถือว่าอนุมัติแล้ว)
    const [insDN] = await conn.query(
      `INSERT INTO delivery_notes (id, pair_id, delivery_note_code, sales_order_id, delivery_date, status, created_at, updated_at)
       VALUES (NULL, ?, ?, ?, CURDATE(), 'กำลังส่ง', NOW(), NOW())`,
      [pair.pair_id, pair.dn_no, sales_order_id]
    );
    const dn_id = insDN.insertId;

    // สร้างหัว Invoice (approved)
    const [insINV] = await conn.query(
      `INSERT INTO invoices (pair_id, invoice_no, sales_order_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'approved', NOW(), NOW())`,
      [pair.pair_id, pair.inv_no, sales_order_id]
    );
    const inv_id = insINV.insertId;

    let totalSub = 0;
    let anyLine = false;

    // วนส่งเฉพาะแถวที่ผู้ใช้เลือก
    for (const soItemId of item_ids) {
      // ล็อกรายการขาย + สินค้า
      const [[it]] = await conn.query(
        `SELECT
            soi.id,
            soi.product_id,
            soi.quantity AS ordered,
            COALESCE(pp.price, p.price) AS unit_price,
            p.stock, p.reserved
          FROM sales_order_items soi
          JOIN products p
            ON p.id = soi.product_id
          LEFT JOIN product_prices pp
            ON pp.product_id = soi.product_id
          AND pp.customer_id = ?          -- ราคาตามลูกค้า
          WHERE soi.id=? AND soi.sales_order_id=? FOR UPDATE`,
        [so.customer_id, soItemId, sales_order_id]
      );
      if (!it) throw new Error(`ไม่พบรายการขาย id ${soItemId}`);

      // remaining = ordered - delivered (คำนวณจาก DN items)
      const delivered = Number(beforeDelivered.get(soItemId) || 0);
      const remaining = Math.max(it.ordered - delivered, 0);

      // reserved_left ของแถวนี้ (SO+สินค้าเดียวกัน)
      const [[rsv]] = await conn.query(
        `SELECT COALESCE(SUM(quantity_reserved),0) AS reserved_left
         FROM stock_reservations
         WHERE sales_order_id=? AND product_id=? AND is_deleted=0
               AND status='จองแล้ว' AND (used_in_dn_id IS NULL OR used_in_dn_id=0)
         FOR UPDATE`,
        [sales_order_id, it.product_id]
      );
      const reserved_left = Number(rsv.reserved_left || 0);

      // กติกา: Reserve = Deliver → ส่งเท่าที่จอง แต่ไม่เกิน remaining
      const deliver_now = Math.min(remaining, reserved_left);
      if (deliver_now <= 0) continue;

      // กัน overship + กันสต๊อกติดลบ
      if (deliver_now > remaining) throw new Error("ห้ามส่งเกินยอดที่สั่ง");
      if (it.stock < deliver_now) throw new Error(`สต๊อกไม่พอสำหรับสินค้า ID ${it.product_id}`);

      // เพิ่มรายการ DN (snapshot ราคา ณ ตอนส่งจาก products.price)
      const unitPrice  = Number(it.unit_price || 0);
      const lineAmount = +(unitPrice * deliver_now).toFixed(2);
      await conn.query(
        `INSERT INTO delivery_note_items (delivery_note_id, sales_order_item_id, product_id,
                                          quantity_delivered, unit_price, line_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [dn_id, soItemId, it.product_id, deliver_now, it.unit_price || 0, lineAmount]
      );

      // เพิ่มรายการ Invoice (1 DN : 1 INV)
      await conn.query(
        `INSERT INTO invoice_items (invoice_id, sales_order_item_id, product_id, quantity, unit_price, line_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [inv_id, soItemId, it.product_id, deliver_now, it.unit_price || 0, lineAmount]
      );

      // ตัดสต๊อก + ลด reserved (ระดับสินค้า)
      await conn.query(
        `UPDATE products SET stock = stock - ?, reserved = reserved - ? WHERE id = ?`,
        [deliver_now, deliver_now, it.product_id]
      );

      // มาร์คการจองเป็น "ส่งแล้ว" และผูก DN (FIFO)
      const [rsvRows] = await conn.query(
        `SELECT id, quantity_reserved
         FROM stock_reservations
         WHERE sales_order_id=? AND product_id=? AND is_deleted=0
               AND status='จองแล้ว' AND (used_in_dn_id IS NULL OR used_in_dn_id=0)
         ORDER BY id ASC FOR UPDATE`,
        [sales_order_id, it.product_id]
      );
      let need = deliver_now;
      for (const r of rsvRows) {
        if (need <= 0) break;
        // แนวทางเรา: Reserve ต้องเท่ากับที่จะส่ง → ส่วนใหญ่จะตัดทั้งก้อน
        await conn.query(
          `UPDATE stock_reservations SET status='ส่งแล้ว', used_in_dn_id=? WHERE id=?`,
          [dn_id, r.id]
        );
        need -= Number(r.quantity_reserved);
      }

      totalSub += lineAmount;
      anyLine = true;
    }

    if (!anyLine) throw new Error("ไม่มีรายการที่พร้อมส่ง");

/*
    // อัปเดตรวมเงินที่หัว Invoice (ยังไม่คิด VAT: 0%)
    await conn.query(
      `UPDATE invoices SET subtotal=?, vat_rate=0, vat_amount=0, grand_total=? WHERE id=?`,
      [totalSub, totalSub, inv_id]
    );
*/


    // อัปเดตสถานะ SO (ส่งบางส่วน/ส่งครบแล้ว)
    const [chk] = await conn.query(
      `
      SELECT
        soi.id,
        soi.quantity AS ordered,
        COALESCE(SUM(dni.quantity_delivered), 0) AS delivered
      FROM sales_order_items soi
      LEFT JOIN delivery_note_items dni
        ON dni.sales_order_item_id = soi.id
      LEFT JOIN delivery_notes dn
        ON dn.id = dni.delivery_note_id
      AND dn.sales_order_id = soi.sales_order_id   
      WHERE soi.sales_order_id = ?
        AND soi.is_deleted = 0                       
      GROUP BY soi.id, soi.quantity
      `,
      [sales_order_id]
    );
    const doneLines = chk.filter(r => Number(r.delivered) >= Number(r.ordered)).length;
    const statusSO = (doneLines === chk.length) ? 'ส่งครบแล้ว' : 'ส่งบางส่วน';
    await conn.query(`UPDATE sales_orders SET status=?, updated_at=NOW() WHERE id=?`, [statusSO, sales_order_id]);

    await conn.commit();
    res.json({ ok: true, pair: { dn_id, dn_no: pair.dn_no, inv_id, inv_no: pair.inv_no } });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || "ส่งไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};
