const db = require('../db/connection');

exports.deductStock = async (req, res) => {
  const connection = await db.getConnection();
  const { items, employee_id, reason, delivery_ref } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0 || !employee_id) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
  }

  try {
    await connection.beginTransaction();
    const results = [];

    for (const item of items) {
      const { product_id, quantity } = item;

      // 1. ดึง stock และ reorder_point ปัจจุบัน
      const [productRows] = await connection.query(
        `SELECT stock, reorder_point FROM products WHERE id = ? AND is_deleted = FALSE`,
        [product_id]
      );

      if (productRows.length === 0) {
        results.push({ product_id, status: 'error', reason: 'ไม่พบสินค้า' });
        continue;
      }

      const currentStock = productRows[0].stock;
      const reorderPoint = productRows[0].reorder_point;

      if (currentStock < quantity) {
        results.push({ product_id, status: 'error', reason: 'stock ไม่เพียงพอ' });
        continue;
      }

      // 2. ตัด stock
      await connection.query(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [quantity, product_id]
      );


      // ✅ ลด reserved
      await connection.query(
        `UPDATE products SET reserved = GREATEST(reserved - ?, 0) WHERE id = ?`,
        [quantity, product_id]
      );



      // 3. บันทึกลง log
      await connection.query(
        `INSERT INTO product_reorder_history 
          (product_id, current_quantity, reorder_point, notified_at, action_taken, employee_id)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [product_id, currentStock, reorderPoint, reason || 'ตัด stock แบบ manual', employee_id]
      );

      results.push({ product_id, status: 'success', new_stock: currentStock - quantity });
    }

    await connection.commit();
    res.status(200).json({ message: 'ตัด stock เรียบร้อย', results });
  } catch (error) {
    await connection.rollback();
    console.error('Error deducting stock:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};











