const db = require("../db/connection");

// ✅ POST /bom-components – เพิ่ม Component เข้า BOM
exports.addBOMComponent = async (req, res) => {
  const { bom_id, product_id, quantity_required } = req.body;

  if (!bom_id || !product_id || !quantity_required) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO bom_components (bom_id, product_id, quantity_required)
       VALUES (?, ?, ?)`,
      [bom_id, product_id, quantity_required]
    );
    res.status(201).json({ message: "เพิ่ม component สำเร็จ", id: result.insertId });
  } catch (error) {
    console.error("❌ addBOMComponent error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};

// ✅ GET /bom-components?bom_id=1 – ดึง component ของ BOM นั้น ๆ
exports.getComponentsByBOMId = async (req, res) => {
  const { bom_id } = req.query;

  if (!bom_id) {
    return res.status(400).json({ message: "กรุณาระบุ bom_id" });
  }

  try {
    const [rows] = await db.query(
      `SELECT bc.id, bc.bom_id, bc.product_id, p.name, p.stock, bc.quantity_required
       FROM bom_components bc
       JOIN products p ON bc.product_id = p.id
       WHERE bc.bom_id = ?`,
      [bom_id]
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ getComponentsByBOMId error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};

// ✅ PUT /bom-components/:id – แก้ไข component
exports.updateBOMComponent = async (req, res) => {
  const { id } = req.params;
  const { product_id, quantity_required } = req.body;

  // เช็คว่าไม่มีอะไรส่งมาเลย
  if (!product_id && !quantity_required) {
    return res.status(400).json({ message: "ต้องระบุ product_id หรือ quantity_required อย่างน้อยหนึ่งอย่าง" });
  }

  try {
    // สร้างชุด query แบบ dynamic
    let fields = [];
    let values = [];

    if (product_id) {
      fields.push("product_id = ?");
      values.push(product_id);
    }

    if (quantity_required) {
      fields.push("quantity_required = ?");
      values.push(quantity_required);
    }

    values.push(id); // id สุดท้าย

    const query = `UPDATE bom_components SET ${fields.join(", ")} WHERE id = ?`;

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ Component ที่ต้องการแก้ไข" });
    }

    res.json({ message: "แก้ไข Component สำเร็จ" });
  } catch (error) {
    console.error("❌ updateBOMComponent error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};

// ✅ DELETE /bom-components/:id – ลบ component
exports.deleteBOMComponent = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query(`DELETE FROM bom_components WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ Component ที่ต้องการลบ" });
    }

    res.json({ message: "ลบ Component สำเร็จแล้ว" });
  } catch (error) {
    console.error("❌ deleteBOMComponent error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};


// POST /bom-components/bulk
exports.addMultipleComponents = async (req, res) => {
  const { bom_id, components } = req.body;

  if (!bom_id || !Array.isArray(components) || components.length === 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    const values = components.map(c => [bom_id, c.product_id, c.quantity_required]);
    await db.query(
      `INSERT INTO bom_components (bom_id, product_id, quantity_required) VALUES ?`,
      [values]
    );
    res.status(201).json({ message: "เพิ่ม components สำเร็จ" });
  } catch (error) {
    console.error("❌ addMultipleComponents error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};
