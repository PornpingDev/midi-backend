// controllers/purchaseOrdersController.js
const db = require("../db/connection");


// =====================================================
// Helper: Generate PO Number (ใช้ manual_counters อย่างเดียว)
// =====================================================
function buddhistYearYY() {
  const be = new Date().getFullYear() + 543;
  return { beYear: be, yy: String(be).slice(-2) };
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

// ต้องเรียกภายใน transaction เท่านั้น
async function nextPONumber(conn) {
  const { beYear, yy } = buddhistYearYY();
  const kind = "PO";
  const prefix = "MPO";

  await conn.query(
    `
    INSERT INTO manual_counters (be_year, kind, prefix, last_seq)
    VALUES (?, ?, ?, LAST_INSERT_ID(1))
    ON DUPLICATE KEY UPDATE
      last_seq = LAST_INSERT_ID(last_seq + 1),
      prefix   = VALUES(prefix)
    `,
    [beYear, kind, prefix]
  );

  const [[ctr]] = await conn.query(`SELECT LAST_INSERT_ID() AS next_seq`);
  const nextSeq = Number(ctr?.next_seq || 1);

  return { po_no: `${prefix}${yy}-${String(nextSeq).padStart(3, "0")}` };
}






// 🔵 POST /purchase-orders
// สร้างใบสั่งซื้อ (PO) พร้อมรายการ
exports.createPurchaseOrder = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      po_no,            // อาจไม่ส่งมาก็ได้
      supplier_id,
      order_date,
      expected_date,
      note,
      items,
    } = req.body;

    // ✅ เปลี่ยน validation: ไม่บังคับ po_no แล้ว
    if (!supplier_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "กรุณากรอก supplier_id และรายการสินค้าอย่างน้อย 1 รายการ",
      });
    }

    // ถ้าไม่ส่ง order_date มา ใช้วันนี้
    const finalOrderDate = order_date || new Date().toISOString().split("T")[0];
    const finalExpectedDate = expected_date || null;

    await conn.beginTransaction();

    // ✅ ถ้าไม่ส่ง po_no มา → generate เลขจาก manual_counters (MPOYY-XXX)
    let finalPONo = po_no;
    if (!finalPONo || String(finalPONo).trim() === "") {
      const gen = await nextPONumber(conn);
      finalPONo = gen.po_no;
    }

    // 1) สร้างหัวใบสั่งซื้อ
    const [poResult] = await conn.query(
      `INSERT INTO purchase_orders
         (po_no, supplier_id, order_date, expected_date, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, NOW(), NOW())`,
      [finalPONo, supplier_id, finalOrderDate, finalExpectedDate, note || null]
    );

    const purchase_order_id = poResult.insertId;

    // 2) สร้างรายการ PO items
    for (const item of items) {
      if (!item.product_id || !item.quantity_ordered) continue;

      const qty = Number(item.quantity_ordered) || 0;
      const price = Number(item.unit_price || 0);

      await conn.query(
        `INSERT INTO purchase_order_items
           (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price,
            supplier_product_name, supplier_product_code, remarks, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, NOW(), NOW())`,
        [
          purchase_order_id,
          item.product_id,
          qty,
          price,
          item.supplier_product_name || null,
          item.supplier_product_code || null,
          item.remarks || null,
        ]
      );
    }

    await conn.commit();

    res.json({
      message: "✅ สร้างใบสั่งซื้อสำเร็จ",
      id: purchase_order_id,
      po_no: finalPONo,          // ✅ ส่งเลขที่สร้างจริงกลับไป
      status: "draft",
    });
  } catch (err) {
    await conn.rollback();
    console.error("❌ createPurchaseOrder error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้างใบสั่งซื้อ" });
  } finally {
    conn.release();
  }
};


// 🔵 GET /purchase-orders
// ดึงรายการ PO ทั้งหมด (หน้า List)
exports.getAllPurchaseOrders = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        po.id,
        po.po_no,
        po.order_date,
        po.expected_date,
        po.status,
        po.note,
        po.created_at,
        s.name AS supplier_name,
        -- รวมยอดเงินจากรายการ (quantity_ordered * unit_price)
        (
          SELECT COALESCE(SUM(i.quantity_ordered * i.unit_price), 0)
          FROM purchase_order_items i
          WHERE i.purchase_order_id = po.id
        ) AS total_amount,
        -- วันที่รับของล่าสุด (ถ้ามี GR แล้ว)
        (
          SELECT MAX(gr.received_date)
          FROM goods_receipts gr
          WHERE gr.purchase_order_id = po.id
        ) AS last_received_date
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ getAllPurchaseOrders error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายการใบสั่งซื้อ" });
  }
};

// 🔵 GET /purchase-orders/:id
// ดึงหัว + รายการของ PO ใบเดียว
exports.getPurchaseOrderById = async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) {
    return res.status(400).json({ message: "po id ไม่ถูกต้อง" });
  }

  try {
    // หัว PO
    const [[po]] = await db.query(
      `SELECT
         po.*,
         s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id
       WHERE po.id = ?`,
      [poId]
    );

    if (!po) {
      return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });
    }

    // รายการ
    const [items] = await db.query(
      `SELECT
         i.id,
         i.product_id,
         p.product_no,
         p.name AS product_name,
         i.quantity_ordered,
         i.quantity_received,
         (i.quantity_ordered - i.quantity_received) AS remaining,
         i.unit_price,
         i.supplier_product_name,
         i.supplier_product_code,
         i.remarks
       FROM purchase_order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.purchase_order_id = ?
       ORDER BY i.id ASC`,
      [poId]
    );

    res.json({
      ...po,
      items,
    });
  } catch (err) {
    console.error("❌ getPurchaseOrderById error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายละเอียดใบสั่งซื้อ" });
  }
};

// 🔵 POST /purchase-orders/:id/items
// เพิ่มรายการสินค้าเข้า PO (ใช้ตอนแก้ไข)
exports.addPurchaseOrderItem = async (req, res) => {
  const poId = Number(req.params.id || 0);
  const { product_id, quantity_ordered, unit_price, supplier_product_name, supplier_product_code, remarks } = req.body;

  if (!poId || !product_id || !quantity_ordered) {
    return res.status(400).json({ message: "ต้องระบุ product_id และ quantity_ordered" });
  }

  try {
    // กันกรณี PO ไม่ใช่ draft
    const [[po]] = await db.query(
      `SELECT status FROM purchase_orders WHERE id = ?`,
      [poId]
    );
    if (!po) {
      return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });
    }
    if (po.status !== "draft") {
      return res.status(400).json({ message: "ไม่สามารถเพิ่มรายการได้: ใบสั่งซื้อไม่ได้อยู่ในสถานะ draft" });
    }

    await db.query(
      `INSERT INTO purchase_order_items
         (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price,
          supplier_product_name, supplier_product_code, remarks, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, NOW(), NOW())`,
      [
        poId,
        product_id,
        Number(quantity_ordered) || 0,
        Number(unit_price || 0),
        supplier_product_name || null,
        supplier_product_code || null,
        remarks || null,
      ]
    );

    res.json({ message: "เพิ่มรายการในใบสั่งซื้อสำเร็จ" });
  } catch (err) {
    console.error("❌ addPurchaseOrderItem error:", err);
    res.status(500).json({ message: "เพิ่มรายการไม่สำเร็จ" });
  }
};

// 🔵 DELETE /purchase-orders/:id/items/:itemId
// ลบรายการออกจาก PO (เฉพาะตอน draft)
exports.deletePurchaseOrderItem = async (req, res) => {
  const poId = Number(req.params.id || 0);
  const itemId = Number(req.params.itemId || 0);

  if (!poId || !itemId) {
    return res.status(400).json({ message: "ต้องระบุ poId และ itemId ให้ถูกต้อง" });
  }

  try {
    const [[po]] = await db.query(
      `SELECT status FROM purchase_orders WHERE id = ?`,
      [poId]
    );
    if (!po) {
      return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });
    }
    if (po.status !== "draft") {
      return res.status(400).json({ message: "ไม่สามารถลบรายการได้: ใบสั่งซื้อไม่ได้อยู่ในสถานะ draft" });
    }

    await db.query(
      `DELETE FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?`,
      [itemId, poId]
    );

    res.json({ message: "ลบรายการในใบสั่งซื้อสำเร็จ" });
  } catch (err) {
    console.error("❌ deletePurchaseOrderItem error:", err);
    res.status(500).json({ message: "ลบรายการไม่สำเร็จ" });
  }
};

// 🔵 POST /purchase-orders/:id/approve
// อนุมัติ PO (ยังไม่ยุ่งกับ stock จนกว่าจะ GR)
exports.approvePurchaseOrder = async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) {
    return res.status(400).json({ message: "po id ไม่ถูกต้อง" });
  }

  try {
    // ต้องมีรายการอย่างน้อย 1 รายการ
    const [[countItems]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM purchase_order_items WHERE purchase_order_id = ?`,
      [poId]
    );
    if (Number(countItems.cnt) === 0) {
      return res.status(400).json({ message: "ไม่สามารถอนุมัติได้: ยังไม่มีรายการสินค้าใน PO" });
    }

    const [[po]] = await db.query(
      `SELECT status FROM purchase_orders WHERE id = ?`,
      [poId]
    );
    if (!po) {
      return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });
    }
    if (po.status !== "draft") {
      return res.status(400).json({ message: "อนุมัติได้เฉพาะใบสั่งซื้อสถานะ draft เท่านั้น" });
    }

    await db.query(
      `UPDATE purchase_orders
       SET status = 'approved', updated_at = NOW()
       WHERE id = ?`,
      [poId]
    );

    res.json({ message: "✅ อนุมัติใบสั่งซื้อสำเร็จ", status: "approved" });
  } catch (err) {
    console.error("❌ approvePurchaseOrder error:", err);
    res.status(500).json({ message: "อนุมัติใบสั่งซื้อไม่สำเร็จ" });
  }
};

// 🔵 DELETE /purchase-orders/:id
// ลบ PO (กันกรณีมี GR แล้ว)
exports.deletePurchaseOrder = async (req, res) => {
  const conn = await db.getConnection();
  const poId = Number(req.params.id || 0);

  if (!poId) {
    return res.status(400).json({ message: "po id ไม่ถูกต้อง" });
  }

  try {
    await conn.beginTransaction();

    // 0) กันลบถ้ามี GR แล้ว
    const [[grChk]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM goods_receipts WHERE purchase_order_id = ?`,
      [poId]
    );
    if (Number(grChk.cnt) > 0) {
      throw new Error("ลบไม่ได้: มีใบรับของ (GR) แล้ว");
    }

    // 1) ลบ items
    await conn.query(
      `DELETE FROM purchase_order_items WHERE purchase_order_id = ?`,
      [poId]
    );

    // 2) ลบหัว PO
    await conn.query(
      `DELETE FROM purchase_orders WHERE id = ?`,
      [poId]
    );

    await conn.commit();
    res.json({ message: "✅ ลบใบสั่งซื้อสำเร็จ" });
  } catch (err) {
    await conn.rollback();
    console.error("❌ deletePurchaseOrder error:", err);
    res.status(400).json({ message: err.message || "ลบใบสั่งซื้อไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};



// GET /purchase-orders/:id/for-receive
// ใช้ดึงข้อมูลหัว PO + รายการ + ยอดคงเหลือ เพื่อเตรียมทำ GR
exports.getForReceivePreview = async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) {
    return res.status(400).json({ message: "po id ไม่ถูกต้อง" });
  }

  const conn = await db.getConnection();
  try {
    // 1) ดึงหัว PO
    const [[po]] = await conn.query(
      `SELECT 
         po.id,
         po.po_no,
         po.order_date,
         po.expected_date,
         po.status,
         po.note,
         s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id
       WHERE po.id = ?`,
      [poId]
    );

    if (!po) {
      return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });
    }

    // 2) ดึงรายการสินค้า + คำนวณ remaining + stock ปัจจุบัน
    const [items] = await conn.query(
      `SELECT
         i.id AS purchase_order_item_id,
         i.product_id,
         p.product_no,
         p.name AS product_name,
         i.quantity_ordered,
         i.quantity_received,
         GREATEST(i.quantity_ordered - i.quantity_received, 0) AS remaining,
         i.unit_price,
         p.stock,
         p.available
       FROM purchase_order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.purchase_order_id = ?
       ORDER BY i.id ASC`,
      [poId]
    );

    res.json({
      ok: true,
      purchase_order: {
        id: po.id,
        po_no: po.po_no,
        order_date: po.order_date,
        expected_date: po.expected_date,
        status: po.status,
        supplier_name: po.supplier_name,
        note: po.note,
      },
      items: items.map((r) => ({
        id: r.purchase_order_item_id,
        product_id: r.product_id,
        product_no: r.product_no,
        product_name: r.product_name,
        ordered: Number(r.quantity_ordered),
        received: Number(r.quantity_received),
        remaining: Number(r.remaining),
        unit_price: Number(r.unit_price),
        stock: Number(r.stock),
        available: Number(r.available),
      })),
    });
  } catch (err) {
    console.error("❌ getForReceivePreview error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลใบสั่งซื้อเพื่อรับของ" });
  } finally {
    conn.release();
  }
};




exports.createAutoPOFromStock = async (req, res) => {
  const { product_no } = req.body;
  if (!product_no) return res.status(400).json({ message: "ต้องระบุ product_no" });

  if (/^BOM-/i.test(product_no)) {
    return res.status(400).json({ message: "สินค้า BOM ไม่สามารถออก PO ได้" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) ดึงสินค้า (ได้ทั้ง id และ product_no)
    const [[product]] = await conn.query(
      `SELECT id, product_no, name, is_deleted
       FROM products
       WHERE product_no = ?
       LIMIT 1`,
      [product_no]
    );
    if (!product || Number(product.is_deleted) === 1) throw new Error("ไม่พบสินค้า หรือถูกลบแล้ว");

    // 2) ดึง default supplier จาก product_suppliers
    // ✅ ใช้ product.product_no เพราะ product_suppliers.product_id FK -> products.product_no
    const [[ps]] = await conn.query(
      `SELECT supplier_id, purchase_price, minimum_order_qty,
              supplier_product_name, supplier_product_code, is_default
       FROM product_suppliers
       WHERE product_id = ?
         AND is_default = 1
       LIMIT 1`,
      [product.product_no]
    );
    if (!ps) throw new Error("ยังไม่ได้ตั้ง default supplier");

    // 3) ps.supplier_id คือ supplier_code → ต้องแปลงเป็น suppliers.id
    const [[sup]] = await conn.query(
      `SELECT id, supplier_code, is_deleted
       FROM suppliers
       WHERE supplier_code = ?
       LIMIT 1`,
      [ps.supplier_id]
    );
    if (!sup || Number(sup.is_deleted) === 1) throw new Error("ไม่พบผู้ขาย (supplier_code) หรือถูกลบแล้ว");

    const supplierIdInt = sup.id;

    // 4) generate PO number
    const { po_no } = await nextPONumber(conn);

    // 5) insert purchase_orders (approved)
    const [poRes] = await conn.query(
      `INSERT INTO purchase_orders
       (po_no, supplier_id, order_date, status, created_at, updated_at)
       VALUES (?, ?, CURDATE(), 'approved', NOW(), NOW())`,
      [po_no, supplierIdInt]
    );

    // 6) insert item (product_id ใน PO items ต้องเป็น products.id)
    const qty = Number(ps.minimum_order_qty || 1);
    const price = Number(ps.purchase_price || 0);

    await conn.query(
      `INSERT INTO purchase_order_items
       (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_price,
        supplier_product_name, supplier_product_code, remarks, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, NULL, NOW(), NOW())`,
      [
        poRes.insertId,
        product.id,
        qty,
        price,
        ps.supplier_product_name || product.name || null,
        ps.supplier_product_code || null,
      ]
    );

    await conn.commit();

    res.json({
      ok: true,
      po_id: poRes.insertId,
      po_no,
      supplier_id: supplierIdInt,
      supplier_code: sup.supplier_code,
      product_no,
      quantity: qty,
      status: "approved",
    });
  } catch (err) {
    await conn.rollback();
    console.error("❌ createAutoPOFromStock:", err);
    res.status(400).json({ message: err.message || "สร้าง Auto PO ไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};



// controllers/purchaseOrdersController.js
// controllers/purchaseOrdersController.js

exports.getPOPrintPayload = async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) return res.status(400).json({ message: "po id ไม่ถูกต้อง" });

  try {
    // 1) Head + Supplier (ดึงข้อมูลผู้ขายให้ครบ)
    const [[h]] = await db.query(
      `
      SELECT
        po.id,
        po.po_no,
        po.order_date,
        po.expected_date,
        po.status,
        po.note,

        s.supplier_code AS supplier_code,
        s.name          AS supplier_name,
        s.address       AS supplier_address,
        s.tax_id        AS supplier_tax_id,
        s.phone         AS supplier_phone,
        s.email         AS supplier_email
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
      LIMIT 1
      `,
      [poId]
    );

    if (!h) return res.status(404).json({ message: "ไม่พบใบสั่งซื้อ" });

    // 2) Items
    const [items] = await db.query(
      `
      SELECT
        i.id,
        i.product_id,
        p.product_no,
        p.name AS product_name,
        p.unit AS unit,
        i.quantity_ordered,
        i.unit_price,
        i.supplier_product_name,
        i.supplier_product_code,
        i.remarks
      FROM purchase_order_items i
      LEFT JOIN products p ON p.id = i.product_id
      WHERE i.purchase_order_id = ?
      ORDER BY i.id ASC
      `,
      [poId]
    );

    // 3) Totals
    const subtotal = (items || []).reduce((sum, it) => {
      const qty = Number(it.quantity_ordered || 0);
      const price = Number(it.unit_price || 0);
      return sum + qty * price;
    }, 0);

    const vatRate = 7; // ✅ purchase_orders ไม่มี vat_rate
    const vatAmount = (subtotal * vatRate) / 100;
    const grandTotal = subtotal + vatAmount;

    const headRemark = (h.note || "").trim();
    // รวมหมายเหตุจากแต่ละรายการ (ถ้ามี)
    const lineRemarks = (items || [])
      .map(it => (it.remarks || "").trim())
      .filter(Boolean);

    // ✅ สรุป remark สำหรับช่อง REMARK ด้านล่าง
    const remarkText = [headRemark, ...lineRemarks].filter(Boolean).join("\n");


    // 4) Payload ให้ตรงกับ PrintDemo + DocumentPrint
    res.json({
      ok: true,
      form: "PO",
      header_title: "ใบสั่งซื้อ (PURCHASE ORDER)",
      header_labels: ["PO"],
      display_no: h.po_no,
      doc_status: String(h.status || "").toUpperCase(),



      customer: {
        name: h.supplier_name || "",
        address: h.supplier_address || "",
        tax_id: h.supplier_tax_id || "",
        email: h.supplier_email || "",
        phone: h.supplier_phone || "",
        supplier_code: h.supplier_code || "",
      },

      document_no: h.po_no,
      document_date: h.order_date,

      remark: remarkText,
      note: headRemark,
      
      expected_date: h.expected_date || null,

      totals: {
        subtotal,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        grand_total: grandTotal,
      },

      items: (items || []).map((it) => {
        const qty = Number(it.quantity_ordered || 0);
        const price = Number(it.unit_price || 0);
        const nameForPO = it.supplier_product_name || it.product_name || "";
        const codeTag = it.supplier_product_code ? ` • ${it.supplier_product_code}` : "";

        return {
          product_no: it.product_no || "",
          name: `${nameForPO}${codeTag}`,
          description: it.remarks || "",
          unit: it.unit || "",
          quantity: qty,
          unit_price: price,
          line_amount: qty * price,
        };
      }),
    });
  } catch (err) {
    console.error("❌ getPOPrintPayload error:", err);
    res.status(500).json({ message: "โหลดข้อมูลสำหรับพิมพ์ PO ไม่สำเร็จ" });
  }
};

