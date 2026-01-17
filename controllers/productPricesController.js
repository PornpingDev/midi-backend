const db = require('../db/connection'); //  ดึงไฟล์เชื่อมต่อ database

//  ฟังก์ชันเพิ่มราคาขายใหม่
exports.createProductPrice = async (req, res) => {
  const { product_id, customer_id, price, customer_product_name } = req.body;

  //  ตรวจสอบว่ากรอกข้อมูลครบไหม
  if (!product_id || !customer_id || price == null) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    //  ใส่ข้อมูลลงตาราง product_prices
    const [result] = await db.query(
      `INSERT INTO product_prices (product_id, customer_id, price, customer_product_name)
       VALUES (?, ?, ?, ?)`,
       [product_id, customer_id, price, customer_product_name]
    );

    res.status(201).json({
      message: 'เพิ่มราคาขายเรียบร้อยแล้ว',
      id: result.insertId
    });

  } catch (error) {
    console.error('❌ Error creating product price:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
};




exports.getProductPrice = async (req, res) => {
  const { product_id } = req.query;

  if (!product_id) {
    return res.status(400).json({ message: 'กรุณาระบุ product_id' });
  }

  try {
    const [rows] = await db.query(
      `SELECT pp.id, pp.customer_id, c.name AS customer_name,
              pp.price, pp.customer_product_name
       FROM product_prices pp
       JOIN customers c ON pp.customer_id = c.id
       WHERE pp.product_id = ?`,
      [product_id]
    );

    res.json(rows);

  } catch (error) {
    console.error('❌ Error fetching product prices:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
};


exports.updateProductPrice = async (req, res) => {
  const { id } = req.params;
  const { price, customer_product_name } = req.body;

  // ถ้าไม่มีข้อมูลจะอัปเดตเลย → return error
  if (price == null && customer_product_name === undefined) {
    return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
  }

  try {
    const fields = [];
    const values = [];

    if (price != null) {
      fields.push("price = ?");
      values.push(price);
    }

    if (customer_product_name !== undefined) {
      fields.push("customer_product_name = ?");
      values.push(customer_product_name);
    }

    values.push(id); // สำหรับ WHERE id = ?

    const [result] = await db.query(
      `UPDATE product_prices SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบรายการราคาขายที่ต้องการแก้ไข' });
    }

    res.json({ message: 'แก้ไขข้อมูลราคาขายเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('❌ Error updating product price:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในระบบ' });
  }
};




exports.deleteProductPrice = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query(
      'DELETE FROM product_prices WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'ไม่พบราคานี้' });
    }

    res.json({ message: 'ลบราคาสำเร็จแล้ว' });
  } catch (error) {
    console.error('❌ ลบราคาล้มเหลว:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบ' });
  }
};
