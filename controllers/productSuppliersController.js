const db = require("../db/connection");



exports.createProductSupplier = async (req, res) => {
  const {
    product_id,
    supplier_id,
    purchase_price,
    lead_time,
    minimum_order_qty,
    is_default,
    remarks,

    // ✅ เพิ่ม 2 ฟิลด์ใหม่
    supplier_product_name,
    supplier_product_code,
  } = req.body;

  if (!product_id || !supplier_id) {
    return res.status(400).json({ message: "กรุณาระบุ product_id และ supplier_id" });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    if (is_default) {
      await conn.query(
        "UPDATE product_suppliers SET is_default = FALSE WHERE product_id = ?",
        [product_id]
      );
    }

    const [result] = await conn.query(
      `INSERT INTO product_suppliers (
        product_id, supplier_id, purchase_price, lead_time,
        minimum_order_qty, is_default, remarks,
        supplier_product_name, supplier_product_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        supplier_id,
        purchase_price || null,
        lead_time || null,
        minimum_order_qty || 1,
        !!is_default,
        remarks || null,

        // ✅ ค่าใหม่ (NULL ได้)
        supplier_product_name || null,
        supplier_product_code || null,
      ]
    );

    await conn.commit();
    res.status(201).json({ message: "เพิ่ม supplier เรียบร้อยแล้ว", id: result.insertId });
  } catch (error) {
    await conn.rollback();
    console.error("❌ Error creating product supplier:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่ม supplier" });
  } finally {
    conn.release();
  }
};



exports.getProductSuppliers = async (req, res) => {
  const { product_id } = req.query;

  if (!product_id) {
    return res.status(400).json({ message: "กรุณาระบุ product_id" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
        ps.id,
        ps.supplier_id,
        s.name AS supplier_name,
        ps.purchase_price,
        ps.lead_time,
        ps.minimum_order_qty,
        ps.is_default,
        ps.remarks,

        -- ✅ เพิ่ม 2 ฟิลด์ใหม่
        ps.supplier_product_name,
        ps.supplier_product_code
       FROM product_suppliers ps
       JOIN suppliers s ON ps.supplier_id = s.supplier_code
       WHERE ps.product_id = ?`,
      [product_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching product suppliers:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
};



exports.updateProductSupplier = async (req, res) => {
  const { id } = req.params;

  const {
    purchase_price,
    lead_time,
    minimum_order_qty,
    is_default,
    remarks,

    // ✅ เพิ่ม 2 ฟิลด์ใหม่
    supplier_product_name,
    supplier_product_code,
  } = req.body;

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const [existing] = await conn.query(
      "SELECT product_id FROM product_suppliers WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบรายการนี้" });
    }

    const product_id = existing[0].product_id;

    if (is_default) {
      await conn.query(
        "UPDATE product_suppliers SET is_default = FALSE WHERE product_id = ?",
        [product_id]
      );
    }

    await conn.query(
      `UPDATE product_suppliers
       SET 
         purchase_price = ?, 
         lead_time = ?, 
         minimum_order_qty = ?, 
         is_default = ?, 
         remarks = ?,
         supplier_product_name = ?,
         supplier_product_code = ?
       WHERE id = ?`,
      [
        purchase_price || null,
        lead_time || null,
        minimum_order_qty || 1,
        !!is_default,
        remarks || null,

        // ✅ ค่าใหม่ (Simple: frontend ส่งมาครบ)
        supplier_product_name || null,
        supplier_product_code || null,

        id,
      ]
    );

    await conn.commit();
    res.json({ message: "อัปเดต supplier เรียบร้อยแล้ว" });
  } catch (error) {
    await conn.rollback();
    console.error("❌ Error updating supplier:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดต" });
  } finally {
    conn.release();
  }
};



exports.deleteProductSupplier = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query(
      "DELETE FROM product_suppliers WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ supplier ที่ต้องการลบ" });
    }

    res.json({ message: "ลบ supplier เรียบร้อยแล้ว" });

  } catch (error) {
    console.error("❌ ลบ supplier ล้มเหลว:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบ" });
  }
};