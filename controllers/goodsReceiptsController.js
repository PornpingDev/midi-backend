// controllers/goodsReceiptsController.js
const db = require("../db/connection");

/* ========= Helpers: ออกเลข MGRYY-XXX ========= */

// ปีพ.ศ.ท้าย 2 หลัก
function buddhistYearYY() {
  const be = new Date().getFullYear() + 543;
  return { beYear: be, yy: String(be).slice(-2) };
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

// หาเลข GR ถัดไปจากตาราง goods_receipts
async function getNextGRNo(conn) {
  const { yy } = buddhistYearYY();
  const prefix = `MGR${yy}-`;           // เช่น MGR68-

  const [rows] = await conn.query(
    `SELECT gr_no
     FROM goods_receipts
     WHERE gr_no LIKE ?
     ORDER BY gr_no DESC
     LIMIT 1`,
    [`${prefix}%`]
  );

  let nextSeq = 1;

  if (rows.length > 0) {
    const last = rows[0].gr_no || "";   // เช่น "MGR68-001"
    const parts = String(last).split("-");
    const lastSeq = parseInt(parts[1], 10) || 0;
    nextSeq = lastSeq + 1;
  }

  return `${prefix}${pad3(nextSeq)}`;   // → MGR68-002, MGR68-003, ...
}

/* ========= POST /goods-receipts/receive-now ========= */
// รับของตาม PO ทันที (สร้าง GR + ตัด stock + อัปเดต PO)
exports.receiveNow = async (req, res) => {
  const {
    purchase_order_id,
    // gr_no,      // ❌ ไม่ใช้จาก body แล้ว
    received_date,
    note,
    items, // [{ purchase_order_item_id, quantity_received }]
  } = req.body;

  const poId = Number(purchase_order_id || 0);

  // ✅ validation ใหม่ ไม่บังคับ gr_no แล้ว
  if (!poId || !Array.isArray(items) || items.length === 0) {
    return res
      .status(400)
      .json({ message: "ต้องระบุ purchase_order_id และรายการสินค้าอย่างน้อย 1 รายการ" });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1) ล็อกหัว PO
    const [[po]] = await conn.query(
      `SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE`,
      [poId]
    );
    if (!po) {
      throw new Error("ไม่พบใบสั่งซื้อ");
    }
    if (!["approved", "partial"].includes(po.status)) {
      throw new Error("สามารถรับของได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว");
    }

    // 2) ดึงรายการ PO items ทั้งหมดของ PO ใบนี้ (ล็อกด้วย FOR UPDATE)
    const [poItems] = await conn.query(
      `SELECT
         id,
         product_id,
         quantity_ordered,
         quantity_received
       FROM purchase_order_items
       WHERE purchase_order_id = ?
       FOR UPDATE`,
      [poId]
    );

    if (poItems.length === 0) {
      throw new Error("ไม่พบรายการสินค้าในใบสั่งซื้อ");
    }

    const poItemMap = new Map();
    poItems.forEach((it) => {
      poItemMap.set(it.id, {
        product_id: it.product_id,
        ordered: Number(it.quantity_ordered || 0),
        received: Number(it.quantity_received || 0),
      });
    });

    // 3) ตรวจสอบรายการที่จะรับของ
    for (const line of items) {
      const poiId = Number(line.purchase_order_item_id || 0);
      const qty = Number(line.quantity_received || 0);

      if (!poiId || qty <= 0) {
        throw new Error("ข้อมูลรายการรับของไม่ถูกต้อง");
      }

      const base = poItemMap.get(poiId);
      if (!base) {
        throw new Error(`ไม่พบรายการสินค้าใน PO (item_id=${poiId})`);
      }

      const remaining = base.ordered - base.received;
      if (qty > remaining) {
        throw new Error(
          `รับของเกินจำนวนที่เหลือ (item_id=${poiId}, เหลือ ${remaining}, รับ ${qty})`
        );
      }
    }

    // 4) สร้างหัว GR (อนุมัติเลย = status 'approved')
    const finalReceivedDate =
      received_date || new Date().toISOString().split("T")[0];

    // ✅ ออกเลข gr_no อัตโนมัติที่นี่
    const gr_no = await getNextGRNo(conn);

    const [grResult] = await conn.query(
      `INSERT INTO goods_receipts
         (gr_no, purchase_order_id, received_date, status, note, created_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, NOW(), NOW())`,
      [gr_no, poId, finalReceivedDate, note || null]
    );

    const grId = grResult.insertId;

    // 5) วนสร้างรายการ GR + อัปเดต PO item + เพิ่ม stock
    for (const line of items) {
      const poiId = Number(line.purchase_order_item_id);
      const qty = Number(line.quantity_received);
      const base = poItemMap.get(poiId);

      // 5.1) insert goods_receipt_items
      await conn.query(
        `INSERT INTO goods_receipt_items
           (goods_receipt_id, purchase_order_item_id, quantity_received, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [grId, poiId, qty]
      );

      // 5.2) update purchase_order_items.quantity_received
      await conn.query(
        `UPDATE purchase_order_items
         SET quantity_received = quantity_received + ?, updated_at = NOW()
         WHERE id = ?`,
        [qty, poiId]
      );

      // 5.3) update products.stock (เพิ่มสต๊อก)
      await conn.query(
        `UPDATE products
         SET stock = stock + ?
         WHERE id = ?`,
        [qty, base.product_id]
      );
    }

    // 6) คำนวณสถานะใหม่ของ PO (partial / completed)
    const [[sumRow]] = await conn.query(
      `SELECT
         SUM(CASE WHEN quantity_received >= quantity_ordered THEN 1 ELSE 0 END) AS full_lines,
         COUNT(*) AS total_lines
       FROM purchase_order_items
       WHERE purchase_order_id = ?`,
      [poId]
    );

    let newStatus = "partial";
    if (
      Number(sumRow.total_lines || 0) > 0 &&
      Number(sumRow.full_lines || 0) === Number(sumRow.total_lines || 0)
    ) {
      newStatus = "completed";
    }

    await conn.query(
      `UPDATE purchase_orders
       SET status = ?, updated_at = NOW()
       WHERE id = ?`,
      [newStatus, poId]
    );

    await conn.commit();

    res.json({
      message: "✅ รับของและตัดสต๊อกสำเร็จ",
      gr_id: grId,
      gr_no, // ✅ ส่งเลขที่ backend ออกให้กลับไปให้ frontend ใช้โชว์
      gr_status: "approved",
      purchase_order_status: newStatus,
    });
  } catch (err) {
    await conn.rollback();
    console.error("❌ receiveNow (GR) error:", err);
    res.status(400).json({ message: err.message || "รับของไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};

/* ========= GET /goods-receipts/:id ========= */
// ไว้ดึงรายละเอียด GR (สำหรับ debug / หน้าเอกสารในอนาคต)
exports.getGoodsReceiptById = async (req, res) => {
  const grId = Number(req.params.id || 0);
  if (!grId) {
    return res.status(400).json({ message: "gr id ไม่ถูกต้อง" });
  }

  try {
    const [[gr]] = await db.query(
      `SELECT
         gr.*,
         po.po_no,
         s.name AS supplier_name
       FROM goods_receipts gr
       JOIN purchase_orders po ON gr.purchase_order_id = po.id
       JOIN suppliers s ON po.supplier_id = s.id
       WHERE gr.id = ?`,
      [grId]
    );
    if (!gr) {
      return res.status(404).json({ message: "ไม่พบใบรับของ" });
    }

    const [items] = await db.query(
      `SELECT
         gri.id,
         gri.purchase_order_item_id,
         gri.quantity_received,
         poi.product_id,
         p.product_no,
         p.name AS product_name
       FROM goods_receipt_items gri
       JOIN purchase_order_items poi ON gri.purchase_order_item_id = poi.id
       JOIN products p ON poi.product_id = p.id
       WHERE gri.goods_receipt_id = ?
       ORDER BY gri.id ASC`,
      [grId]
    );

    res.json({
      ...gr,
      items,
    });
  } catch (err) {
    console.error("❌ getGoodsReceiptById error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลใบรับของ" });
  }
};


// ========= GET history by purchase order =========
// ดึงประวัติการรับของทั้งหมดของใบสั่งซื้อนี้
exports.getHistoryByPurchaseOrder = async (req, res) => {
  const poId = Number(req.params.id || 0);

  if (!poId) {
    return res
      .status(400)
      .json({ message: "purchase_order_id ไม่ถูกต้อง" });
  }

  try {
    // 1) ดึงหัว GR ทั้งหมดของ PO ใบนี้
    const [grRows] = await db.query(
      `SELECT
         gr.id,
         gr.gr_no,
         gr.purchase_order_id,
         gr.received_date,
         gr.status,
         gr.note
       FROM goods_receipts gr
       WHERE gr.purchase_order_id = ?
       ORDER BY gr.received_date ASC, gr.id ASC`,
      [poId]
    );

    // ถ้ายังไม่เคยรับของเลย → ส่ง array ว่างกลับไป
    if (grRows.length === 0) {
      return res.json({
        purchase_order_id: poId,
        goodsReceipts: [],            // 👈 ให้ชื่อ field ตรงกับ frontend
      });
    }

    const grIds = grRows.map((r) => r.id);

    // สร้าง placeholder ให้ IN (?, ?, ?)
    const placeholders = grIds.map(() => "?").join(",");

    // 2) ดึงรายการสินค้าในแต่ละ GR
    const [itemRows] = await db.query(
      `SELECT
         gri.id,
         gri.goods_receipt_id,
         gri.purchase_order_item_id,
         gri.quantity_received,
         poi.product_id,
         p.product_no,
         p.name AS product_name,      -- ใช้เหมือน getPurchaseOrderById
         poi.unit_price
       FROM goods_receipt_items gri
       JOIN purchase_order_items poi
         ON gri.purchase_order_item_id = poi.id
       JOIN products p
         ON poi.product_id = p.id
       WHERE gri.goods_receipt_id IN (${placeholders})
       ORDER BY gri.goods_receipt_id ASC, gri.id ASC`,
      grIds
    );

    // 3) รวมของเป็นโครงสร้าง { goodsReceipts: [ {items: [...]}, ... ] }
    const map = {};
    grRows.forEach((gr) => {
      map[gr.id] = {
        id: gr.id,
        gr_no: gr.gr_no,
        received_date: gr.received_date,
        status: gr.status,
        note: gr.note,
        items: [],
      };
    });

    itemRows.forEach((it) => {
      const target = map[it.goods_receipt_id];
      if (!target) return;
      target.items.push({
        id: it.id,
        purchase_order_item_id: it.purchase_order_item_id,
        product_id: it.product_id,
        product_no: it.product_no,
        product_name: it.product_name,
        quantity_received: Number(it.quantity_received || 0),
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
      });
    });

    res.json({
      purchase_order_id: poId,
      goodsReceipts: Object.values(map),   // 👈 ชื่อ field ตรงกับ React
    });
  } catch (err) {
    console.error("❌ getHistoryByPurchaseOrder error:", err);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงประวัติรับของ" });
  }
};
