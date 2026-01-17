const db = require("../db/connection");


// สร้าง/คืน product สำหรับ BOM หนึ่ง ๆ
async function ensureProductForBOM(conn, bom_code, bom_name) {
  // หา product ตามรหัส BOM
  const [exist] = await conn.query(
    `SELECT id, is_deleted FROM products WHERE product_no = ? LIMIT 1`,
    [bom_code]
  );

  // มีอยู่แล้ว
  if (exist.length) {
    const p = exist[0];
    if (p.is_deleted) {
      // restore + sync ชื่อ
      await conn.query(
        `UPDATE products
         SET is_deleted = 0, name = ?, updated_at = NOW()
         WHERE id = ?`,
        [bom_name, p.id]
      );
    } else {
      // sync ชื่อให้ตรงกับชื่อ BOM ล่าสุด
      await conn.query(
        `UPDATE products SET name = ?, updated_at = NOW() WHERE id = ?`,
        [bom_name, p.id]
      );
    }
    return p.id;
  }

  // ยังไม่มี → สร้างใหม่ (สำคัญ: stock/reserved ต้องเป็น 0 ไม่ใช่ NULL)
  const [ins] = await conn.query(
    `INSERT INTO products
     (product_no, name, stock, reserved, cost, price, lead_time, reorder_point, unit, is_deleted, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, 7, 0, 'ชิ้น', 0, NOW(), NOW())`,
    [bom_code, bom_name]
  );
  return ins.insertId;
}






// 🔧 สร้างรหัส BOM อัตโนมัติ เช่น BOM-001
const generateBOMCode = async () => {
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM boms`);
  const count = rows[0].count + 1;
  return `BOM-${String(count).padStart(3, "0")}`;
};

// ✅ POST /boms – เพิ่ม BOM เฉพาะหัว
exports.createBOM = async (req, res) => {
  const { bom_name } = req.body;

  if (!bom_name) {
    return res.status(400).json({ message: "กรุณาระบุชื่อ BOM" });
  }

  try {
    const bom_code = await generateBOMCode();
    const [result] = await db.query(
      `INSERT INTO boms (bom_code, bom_name) VALUES (?, ?)`,
      [bom_code, bom_name]
    );
    res.status(201).json({ message: "เพิ่ม BOM สำเร็จ", id: result.insertId, bom_code });
  } catch (error) {
    console.error("❌ createBOM error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้าง BOM" });
  }
};

// ✅ POST /boms/full – เพิ่ม BOM พร้อม components หลายรายการ
exports.createFullBOM = async (req, res) => {
  const { bom_name, components } = req.body;

  if (!bom_name || !Array.isArray(components)) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom_code = await generateBOMCode();
    const [bomResult] = await conn.query(
      `INSERT INTO boms (bom_code, bom_name) VALUES (?, ?)`,
      [bom_code, bom_name]
    );
    const bom_id = bomResult.insertId;

    if (components.length > 0) {
      const insertValues = components.map((c) => [bom_id, c.product_id, c.quantity_required]);
      await conn.query(
        `INSERT INTO bom_components (bom_id, product_id, quantity_required) VALUES ?`,
        [insertValues]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "เพิ่ม BOM พร้อม Components สำเร็จ", bom_id, bom_code });
  } catch (error) {
    await conn.rollback();
    console.error("❌ createFullBOM error:", error);
    res.status(500).json({ message: "ไม่สามารถเพิ่ม BOM ได้" });
  } finally {
    conn.release();
  }
};


/*
// ✅ GET /boms – ดึง BOM ทั้งหมด
exports.getAllBOMs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM boms 
      WHERE is_deleted = 0 
      ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error("❌ getAllBOMs error:", error);
    res.status(500).json({ message: "ไม่สามารถดึง BOM ได้" });
  }
};

*/

exports.getAllBOMs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        b.id, b.bom_code, b.bom_name, b.created_at, b.updated_at,
        p.id AS product_id,
        COALESCE(p.available, 0) AS bom_available
      FROM boms b
      LEFT JOIN products p
        ON p.product_no = b.bom_code AND p.is_deleted = 0
      WHERE b.is_deleted = 0
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error("❌ getAllBOMs error:", error);
    res.status(500).json({ message: "ไม่สามารถดึง BOM ได้" });
  }
};




// ✅ GET /boms/:id – ดึง BOM เดี่ยว
exports.getBOMById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(`SELECT * FROM boms WHERE id = ? AND is_deleted = 0`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบ BOM นี้" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("❌ getBOMById error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึง BOM" });
  }
};

// ✅ PUT /boms/:id – แก้ไข BOM
/*
exports.updateBOM = async (req, res) => {
  const { id } = req.params;
  const { bom_name } = req.body;

  if (!bom_name) {
    return res.status(400).json({ message: "กรุณาระบุชื่อ BOM ใหม่" });
  }

  try {
    const [result] = await db.query(
      `UPDATE boms SET bom_name = ? WHERE id = ?`,
      [bom_name, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ BOM ที่ต้องการแก้ไข" });
    }
    res.json({ message: "แก้ไข BOM สำเร็จ" });
  } catch (error) {
    console.error("❌ updateBOM error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไข BOM" });
  }
};
*/
// ✅ PUT /boms/:id – แก้ไข BOM + sync ชื่อสินค้าในสต๊อก
exports.updateBOM = async (req, res) => {
  const { id } = req.params;
  const { bom_name } = req.body;
  if (!bom_name) return res.status(400).json({ message: "กรุณาระบุชื่อ BOM ใหม่" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // เอา bom_code มาก่อน เพื่อรู้ว่าจะไปอัปเดต product ตัวไหน
    const [[bom]] = await conn.query(
      `SELECT bom_code FROM boms WHERE id = ? AND is_deleted = 0`,
      [id]
    );
    if (!bom) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ BOM ที่ต้องการแก้ไข" });
    }

    // อัปเดตชื่อ BOM
    await conn.query(
      `UPDATE boms SET bom_name = ?, updated_at = NOW() WHERE id = ?`,
      [bom_name, id]
    );

    // 🔁 sync ชื่อไปที่ products ที่ product_no = bom_code
    await conn.query(
      `UPDATE products
         SET name = ?, updated_at = NOW()
       WHERE product_no = ? AND is_deleted = 0`,
      [bom_name, bom.bom_code]
    );

    await conn.commit();
    res.json({ message: "แก้ไข BOM สำเร็จ (ซิงก์ชื่อสินค้าแล้ว)" });
  } catch (error) {
    await conn.rollback();
    console.error("❌ updateBOM error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไข BOM" });
  } finally {
    conn.release();
  }
};









// ✅ DELETE /boms/:id – ลบ BOM
exports.deleteBOM = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query(`UPDATE boms SET is_deleted = 1 WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ BOM ที่ต้องการลบ" });
    }
    res.json({ message: "ลบ BOM สำเร็จแล้ว" });
  } catch (error) {
    console.error("❌ deleteBOM error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบ BOM" });
  }
};

/*
// ✅ PUT /boms/full/:id – แก้ไข BOM พร้อม component
exports.updateBOMWithComponents = async (req, res) => {
  const db = require("../db/connection");
  const { id } = req.params;
  const { bom_name, components } = req.body;

  if (!bom_name || !Array.isArray(components)) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // ตรวจสอบว่า BOM มีอยู่จริงหรือไม่
    const [existing] = await connection.query(`SELECT id FROM boms WHERE id = ?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: "ไม่พบ BOM นี้" });
    }

    // อัปเดตชื่อ BOM
    await connection.query(
      `UPDATE boms SET bom_name = ?, updated_at = NOW() WHERE id = ?`,
      [bom_name, id]
    );

    // ลบ components เดิมทิ้งทั้งหมด
    await connection.query(`DELETE FROM bom_components WHERE bom_id = ?`, [id]);

    // เตรียม insert ใหม่
    const insertValues = components
      .filter((c) => c.product_id && c.quantity_required)
      .map((c) => [id, c.product_id, c.quantity_required]);

    if (insertValues.length > 0) {
      await connection.query(
        `INSERT INTO bom_components (bom_id, product_id, quantity_required) VALUES ?`,
        [insertValues]
      );
    }

    await connection.commit();
    res.json({ message: "อัปเดต BOM สำเร็จแล้ว" });
  } catch (error) {
    await connection.rollback();
    console.error("❌ updateBOMWithComponents error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดต BOM" });
  } finally {
    connection.release();
  }
};
*/

// ✅ PUT /boms/full/:id – อัปเดต BOM + components + sync ชื่อสินค้า
exports.updateBOMWithComponents = async (req, res) => {
  const { id } = req.params;
  const { bom_name, components } = req.body;
  if (!bom_name || !Array.isArray(components)) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [[bom]] = await connection.query(
      `SELECT bom_code FROM boms WHERE id = ? AND is_deleted = 0`,
      [id]
    );
    if (!bom) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบ BOM นี้" });
    }

    await connection.query(
      `UPDATE boms SET bom_name = ?, updated_at = NOW() WHERE id = ?`,
      [bom_name, id]
    );

    // ลบ-ใส่ components ใหม่ (เหมือนเดิม)
    await connection.query(`DELETE FROM bom_components WHERE bom_id = ?`, [id]);
    const values = components
      .filter(c => c.product_id && c.quantity_required)
      .map(c => [id, c.product_id, c.quantity_required]);
    if (values.length) {
      await connection.query(
        `INSERT INTO bom_components (bom_id, product_id, quantity_required) VALUES ?`,
        [values]
      );
    }

    // 🔁 sync ชื่อสินค้าในสต๊อก
    await connection.query(
      `UPDATE products SET name = ?, updated_at = NOW()
       WHERE product_no = ? AND is_deleted = 0`,
      [bom_name, bom.bom_code]
    );

    await connection.commit();
    res.json({ message: "อัปเดต BOM สำเร็จแล้ว (ซิงก์ชื่อสินค้าแล้ว)" });
  } catch (error) {
    await connection.rollback();
    console.error("❌ updateBOMWithComponents error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดต BOM" });
  } finally {
    connection.release();
  }
};


// ====== BUILDABILITY / PREVIEW / RESERVE / PRODUCE / UNRESERVE ======

/** ดึงหัว BOM ไว้ใช้ซ้ำ */
async function getBomHead(conn, id) {
  const [[bom]] = await conn.query(
    `SELECT id, bom_code, bom_name FROM boms WHERE id=? AND is_deleted=0`,
    [id]
  );
  return bom || null;
}

/** พรีวิวการใช้วัตถุดิบของ BOM ปริมาณ qty หน่วย */
async function getPreviewRows(conn, bomId, qty) {
  const [rows] = await conn.query(
    `
    SELECT
      bc.bom_id,
      b.bom_code,
      p.id         AS product_id,
      p.product_no,
      p.name,
      p.unit,
      bc.quantity_required,

      (CAST(bc.quantity_required AS SIGNED) * ?) AS required,

      CAST(p.reserved AS SIGNED) AS reserved,

      GREATEST(CAST(COALESCE(p.available, 0) AS SIGNED), 0) AS available,

      GREATEST(
        (CAST(bc.quantity_required AS SIGNED) * ?)
        - GREATEST(CAST(COALESCE(p.available, 0) AS SIGNED), 0),
        0
      ) AS shortage

    FROM bom_components bc
    JOIN boms b     ON b.id = bc.bom_id AND b.is_deleted = 0
    JOIN products p ON p.id = bc.product_id AND p.is_deleted = 0
    WHERE bc.bom_id = ?
    ORDER BY p.product_no
    `,
    [qty, qty, bomId]
  );
  return rows;
}

/** GET /boms/:id/buildability  → {max_buildable} */
exports.getBuildability = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const [[row]] = await conn.query(
      `
      SELECT COALESCE(
        MIN(
          FLOOR(
            GREATEST(CAST(COALESCE(p.available,0) AS SIGNED), 0)
            / NULLIF(CAST(bc.quantity_required AS SIGNED), 0)
          )
        ), 0
      ) AS max_buildable
      FROM bom_components bc
      JOIN products p ON p.id = bc.product_id AND p.is_deleted = 0
      JOIN boms b     ON b.id = bc.bom_id AND b.is_deleted = 0
      WHERE bc.bom_id = ?
      `,
      [id]
    );
    res.json(row);
  } catch (e) {
    console.error("getBuildability error:", e);
    res.status(500).json({ message: "คำนวณจำนวนที่ผลิตได้ไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};

/** GET /boms/:id/preview?qty=5  → พรีวิวยอดใช้/คงเหลือ/ขาด */
exports.previewBuild = async (req, res) => {
  const { id } = req.params;
  const qty = Math.max(0, parseInt(req.query.qty ?? "0", 10) || 0);

  const conn = await db.getConnection();
  try {
    const bom = await getBomHead(conn, id);
    if (!bom) return res.status(404).json({ message: "ไม่พบ BOM" });

    const rows = await getPreviewRows(conn, id, qty);
    const can_build = rows.every(r => Number(r.shortage) === 0);
    res.json({ bom_id: id, bom_code: bom.bom_code, qty, can_build, components: rows });
  } catch (e) {
    console.error("previewBuild error:", e);
    res.status(500).json({ message: "พรีวิวไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};

/** POST /boms/:id/reserve  {qty}
 *  จองวัตถุดิบทั้งหมดให้พอผลิต qty หน่วย (เพิ่ม products.reserved)
 */
exports.reserveForBOM = async (req, res) => {
  const { id } = req.params;
  const qty = Math.max(1, parseInt(req.body?.qty ?? "0", 10) || 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom = await getBomHead(conn, id);
    if (!bom) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ BOM" });
    }

    // ล็อกแถววัตถุดิบก่อน (กันจองชน)
    const [locks] = await conn.query(
      `
      SELECT p.id, p.stock, p.reserved, bc.quantity_required*? AS req
      FROM bom_components bc
      JOIN products p ON p.id = bc.product_id AND p.is_deleted = 0
      WHERE bc.bom_id = ?
      FOR UPDATE
      `,
      [qty, id]
    );

    // ตรวจ available
    const lack = locks.find(r => (r.stock - r.reserved) < r.req);
    if (lack) {
      await conn.rollback();
      return res.status(400).json({ message: "สต็อกไม่พอจอง", product_id: lack.id });
    }

    // จอง
    for (const r of locks) {
      await conn.query(
        `UPDATE products SET reserved = reserved + ? WHERE id = ?`,
        [r.req, r.id]
      );
    }

    await conn.commit();
    res.json({ message: "จองวัตถุดิบสำเร็จ", qty });
  } catch (e) {
    await conn.rollback();
    console.error("reserveForBOM error:", e);
    res.status(500).json({ message: "จองวัตถุดิบไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};

/** POST /boms/:id/produce  {qty}
 *  หัก stock+reserved ของวัตถุดิบ และบวก stock ของสินค้าสำเร็จรูป (รหัสเท่ากับ bom_code)
 *  ต้องจองไว้พอ (reserved >= req)
 */
exports.produceFromBOM = async (req, res) => {
  const { id } = req.params;
  const qty = Math.max(1, parseInt(req.body?.qty ?? "0", 10) || 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom = await getBomHead(conn, id);
    if (!bom) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ BOM" });
    }

    // ให้มี product FG เสมอ + ล็อกแถว FG
    const fgProductId = await ensureProductForBOM(conn, bom.bom_code, bom.bom_name);
    await conn.query(`SELECT id FROM products WHERE id=? FOR UPDATE`, [fgProductId]);

    // ล็อกวัตถุดิบ + คำนวณ req
    const [rows] = await conn.query(
      `
      SELECT p.id, p.stock, p.reserved, bc.quantity_required*? AS req
      FROM bom_components bc
      JOIN products p ON p.id = bc.product_id AND p.is_deleted = 0
      WHERE bc.bom_id = ?
      FOR UPDATE
      `,
      [qty, id]
    );

    // ต้องมี reserved พอ และ stock พอ
    const bad = rows.find(r => r.reserved < r.req || r.stock < r.req);
    if (bad) {
      await conn.rollback();
      return res.status(400).json({ message: "ยอดจอง/สต็อกวัตถุดิบไม่พอสำหรับผลิต", product_id: bad.id });
    }

    // ตัดวัตถุดิบ
    for (const r of rows) {
      await conn.query(
        `UPDATE products
           SET stock = stock - ?,
               reserved = reserved - ?,
               updated_at = NOW()
         WHERE id = ?`,
        [r.req, r.req, r.id]
      );
    }

    // บวก FG
    await conn.query(
      `UPDATE products SET stock = stock + ?, updated_at = NOW() WHERE id = ?`,
      [qty, fgProductId]
    );

    await conn.commit();
    res.json({ message: "ผลิตสำเร็จ", qty, fg_product_id: fgProductId, bom_code: bom.bom_code });
  } catch (e) {
    await conn.rollback();
    console.error("produceFromBOM error:", e);
    res.status(500).json({ message: "ผลิตไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};

/** POST /boms/:id/cancel-reserve  {qty}
 *  ยกเลิกการจอง (ลด reserved ลงตาม req)
 */
exports.cancelReserveForBOM = async (req, res) => {
  const { id } = req.params;
  const qty = Math.max(1, parseInt(req.body?.qty ?? "0", 10) || 0);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom = await getBomHead(conn, id);
    if (!bom) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ BOM" });
    }

    const [rows] = await conn.query(
      `
      SELECT p.id, p.reserved, bc.quantity_required*? AS req
      FROM bom_components bc
      JOIN products p ON p.id = bc.product_id AND p.is_deleted = 0
      WHERE bc.bom_id = ?
      FOR UPDATE
      `,
      [qty, id]
    );

    const bad = rows.find(r => r.reserved < r.req);
    if (bad) {
      await conn.rollback();
      return res.status(400).json({ message: "ยอดจองไม่พอสำหรับยกเลิก", product_id: bad.id });
    }

    for (const r of rows) {
      await conn.query(
        `UPDATE products SET reserved = reserved - ?, updated_at = NOW() WHERE id = ?`,
        [r.req, r.id]
      );
    }

    await conn.commit();
    res.json({ message: "ยกเลิกการจองสำเร็จ", qty });
  } catch (e) {
    await conn.rollback();
    console.error("cancelReserveForBOM error:", e);
    res.status(500).json({ message: "ยกเลิกการจองไม่สำเร็จ" });
  } finally {
    conn.release();
  }
};






/*

exports.createBOM = async (req, res) => {
  const { bom_name } = req.body;
  if (!bom_name) return res.status(400).json({ message: "กรุณาระบุชื่อ BOM" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom_code = await generateBOMCode();

    // กันรหัส BOM ซ้ำ (เผื่อมีการ import)
    const [dupB] = await conn.query(
      `SELECT id FROM boms WHERE bom_code=? AND is_deleted=0 LIMIT 1`,
      [bom_code]
    );
    if (dupB.length) throw new Error("รหัส BOM ซ้ำ");

    // บันทึก BOM
    const [result] = await conn.query(
      `INSERT INTO boms (bom_code, bom_name) VALUES (?, ?)`,
      [bom_code, bom_name]
    );

    // ให้มีสินค้า FG เสมอ
    const productId = await ensureProductForBOM(conn, bom_code, bom_name);

    await conn.commit();
    res.status(201).json({
      message: "เพิ่ม BOM สำเร็จ และสร้างสินค้าในสต๊อกแล้ว",
      id: result.insertId,
      bom_code,
      product_id: productId,
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ createBOM error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสร้าง BOM" });
  } finally {
    conn.release();
  }
};


*/



exports.createFullBOM = async (req, res) => {
  const { bom_name, components } = req.body;
  if (!bom_name || !Array.isArray(components)) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const bom_code = await generateBOMCode();

    const [bomResult] = await conn.query(
      `INSERT INTO boms (bom_code, bom_name) VALUES (?, ?)`,
      [bom_code, bom_name]
    );
    const bom_id = bomResult.insertId;

    if (components.length > 0) {
      const insertValues = components.map(c => [bom_id, c.product_id, c.quantity_required]);
      await conn.query(
        `INSERT INTO bom_components (bom_id, product_id, quantity_required) VALUES ?`,
        [insertValues]
      );
    }

    // ให้มีสินค้า FG เสมอ
    const productId = await ensureProductForBOM(conn, bom_code, bom_name);

    await conn.commit();
    res.status(201).json({
      message: "เพิ่ม BOM พร้อม Components สำเร็จ และสร้างสินค้าในสต๊อกแล้ว",
      bom_id,
      bom_code,
      product_id: productId
    });
  } catch (error) {
    await conn.rollback();
    console.error("❌ createFullBOM error:", error);
    res.status(500).json({ message: "ไม่สามารถเพิ่ม BOM ได้" });
  } finally {
    conn.release();
  }
};
