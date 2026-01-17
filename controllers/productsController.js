const db = require('../db/connection');

// ✅ หน่วยที่อนุญาต (ต้องตรงกับ ENUM ใน DB)
const ALLOWED_UNITS = ['ชิ้น','กล่อง','ตัว','ชุด','แผ่น','ม้วน','เส้น','แท่ง','คู่','ดอก','ใบ'];

// ✅ ให้ default = 'ชิ้น' ถ้าไม่ได้ส่งมา / ตรวจความถูกต้อง
function normalizeUnit(unit) {
  if (!unit || unit === '') return 'ชิ้น';
  return ALLOWED_UNITS.includes(unit) ? unit : null;
}



exports.createProduct = async (req, res) => {
  const {
    product_no,
    product_name,
    cost,
    price,
    stock,
    reorder_point,
    lead_time,
    unit,
  } = req.body;

  if (!product_no || !product_name || !cost || !price) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const finalUnit = normalizeUnit(unit);
  if (!finalUnit) {
    return res.status(400).json({ message: 'หน่วยสินค้าไม่ถูกต้อง' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // ตรวจสอบว่า product_no ซ้ำหรือไม่
    const [existing] = await connection.query(
      `SELECT id FROM products WHERE product_no = ?`,
      [product_no]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'รหัสสินค้านี้ถูกใช้ไปแล้ว' });
    }

    // เพิ่มข้อมูลสินค้า
    await connection.query(
      `INSERT INTO products 
        (product_no, name, cost, price, stock, reorder_point, lead_time, unit, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        product_no,
        product_name,
        cost,
        price,
        stock ?? 0,
        reorder_point ?? 0,
        lead_time ?? 0,
        finalUnit,
      ]
    );

    await connection.commit();
    res.status(201).json({ message: 'Product created', product_no });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating product:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};


exports.getAllProducts = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [products] = await connection.query(
      `SELECT 
        id,
        product_no,
        name AS product_name,
        cost,
        price,
        stock,
        reserved,
        available,
        reorder_point,
        unit,
        lead_time,
        created_at
       FROM products
       WHERE is_deleted = FALSE
       ORDER BY id DESC`
    );

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};


exports.getProductById = async (req, res) => {
  const connection = await db.getConnection();
  const { id } = req.params;

  try {
    const [rows] = await connection.query(
      `SELECT 
        id,
        product_no,
        name AS product_name,
        cost,
        price,
        stock,
        reserved,
        available,
        reorder_point,
        lead_time,
        unit,
        created_at
       FROM products
       WHERE id = ? AND is_deleted = FALSE`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบสินค้านี้' });
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};



exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const {
    product_no,
    product_name,
    cost,
    price,
    stock,
    reorder_point,
    lead_time,
    unit, // อาจ undefined ถ้า FE ไม่แก้หน่วย
  } = req.body;

  // ✅ ตรวจ input ให้เสร็จก่อนเปิด connection กัน leak
  if (!product_no || !product_name || !cost || !price) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // ตรวจ product_no ซ้ำกับตัวอื่น
    const [existing] = await connection.query(
      `SELECT id FROM products WHERE product_no = ? AND id != ?`,
      [product_no, id]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'รหัสสินค้านี้ถูกใช้ไปแล้ว' });
    }

    // ✅ ตัดสินใจ finalUnit: ถ้า FE ไม่ส่ง unit มา → คงค่าเดิม
    let finalUnit;
    if (unit === undefined) {
      const [[cur]] = await connection.query(
        `SELECT unit FROM products WHERE id = ? AND is_deleted = FALSE`,
        [id]
      );
      if (!cur) {
        await connection.rollback();
        return res.status(404).json({ message: 'ไม่พบสินค้านี้' });
      }
      finalUnit = cur.unit; // คงค่าหน่วยเดิม
    } else {
      finalUnit = normalizeUnit(unit); // ตรวจตาม ENUM
      if (!finalUnit) {
        await connection.rollback();
        return res.status(400).json({ message: 'หน่วยสินค้าไม่ถูกต้อง' });
      }
    }

    await connection.query(
      `UPDATE products SET 
        product_no = ?,
        name = ?,
        cost = ?,
        price = ?,
        stock = ?,
        reorder_point = ?,
        lead_time = ?,
        unit = ?,               -- ใส่ค่า finalUnit ที่ตัดสินใจแล้ว
        updated_at = NOW()
       WHERE id = ?`,
      [
        product_no,
        product_name,
        cost,
        price,
        stock ?? 0,
        reorder_point ?? 0,
        lead_time ?? 0,
        finalUnit,
        id
      ]
    );

    await connection.commit();
    res.status(200).json({ message: 'Product updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating product:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};





exports.deleteProduct = async (req, res) => {
  const connection = await db.getConnection();
  const { id } = req.params;

  try {
  await connection.beginTransaction();

  await connection.query(
    `UPDATE products SET is_deleted = TRUE WHERE id = ?`,
    [id]
  );
  await connection.commit();
    res.status(200).json({ message: 'ลบสินค้าเรียบร้อยแล้ว' });

  } catch (error) {
    await connection.rollback();
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};



exports.cancelReserveStock = async (req, res) => {
  const { items } = req.body;

  // ✅ ตรวจ input ก่อนเปิด connection
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const results = [];

    for (const item of items) {
      const { product_id, quantity } = item;

      const [rows] = await connection.query(
        `SELECT reserved FROM products WHERE id = ? AND is_deleted = FALSE`,
        [product_id]
      );
      if (rows.length === 0) {
        results.push({ product_id, status: 'error', reason: 'ไม่พบสินค้า' });
        continue;
      }

      const reserved = rows[0].reserved;
      if (reserved < quantity) {
        results.push({ product_id, status: 'error', reason: 'ยอดจองไม่พอสำหรับการยกเลิก' });
        continue;
      }

      await connection.query(
        `UPDATE products SET reserved = reserved - ? WHERE id = ?`,
        [quantity, product_id]
      );

      results.push({ product_id, status: 'success', new_reserved: reserved - quantity });
    }

    await connection.commit();
    res.status(200).json({ message: 'ยกเลิกการจอง stock สำเร็จแล้ว', results });
  } catch (error) {
    await connection.rollback();
    console.error('❌ ยกเลิก stock ล้มเหลว:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};


// หา product ด้วย product_no แบบตรงตัว
exports.getByProductNo = async (req, res) => {
  try {
    const no = String(req.params.no || "").trim();
    if (!no) return res.status(400).json({ message: "invalid product no" });

    const [rows] = await db.query(
      `SELECT id, product_no, name, unit
       FROM products
       WHERE is_deleted = 0 AND product_no = ?
       LIMIT 1`,
      [no]
    );

    if (!rows.length) return res.status(404).json({ message: "not found" });
    res.json({ item: rows[0] });
  } catch (e) {
    console.error("getByProductNo error:", e);
    res.status(500).json({ message: "Server error" });
  }
};


// ✅ สำหรับหน้า PO: ดึงราคาสินค้าตามผู้ขายที่เลือก (ถ้ามี) + ผู้ผลิตหลัก + cost
exports.getProductsForPO = async (req, res) => {
  const { supplier_id } = req.query; // FE ต้องส่ง "SUP-001" เท่านั้น

  // ✅ ถ้าส่งมา ต้องเป็น SUP-xxx ไม่งั้นตอบ 400 ไม่ทำงานต่อ
  if (supplier_id && !String(supplier_id).startsWith("SUP-")) {
    return res.status(400).json({ message: "supplier_id ต้องเป็นรูปแบบ SUP-xxx เช่น SUP-001" });
  }

  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
        p.id,
        p.product_no,
        p.name AS product_name,
        p.cost,
        p.price,
        p.stock,
        p.reserved,
        p.available,
        p.reorder_point,
        p.unit,
        p.lead_time,
        p.created_at,

        ps_supp.purchase_price        AS supplier_purchase_price,
        ps_supp.supplier_product_name AS supplier_product_name,
        ps_supp.supplier_product_code AS supplier_product_code,
        ps_supp.minimum_order_qty     AS minimum_order_qty,
        ps_supp.lead_time             AS supplier_lead_time,

        ps_def.purchase_price         AS default_purchase_price

      FROM products p
      LEFT JOIN product_suppliers ps_supp
        ON ps_supp.product_id = p.product_no
       AND ps_supp.supplier_id = ?

      LEFT JOIN product_suppliers ps_def
        ON ps_def.product_id = p.product_no
       AND ps_def.is_default = 1

      WHERE p.is_deleted = 0
      ORDER BY p.id DESC`,
      [supplier_id || null]
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching products for PO:", error);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    connection.release();
  }
};








