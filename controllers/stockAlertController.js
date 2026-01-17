const db = require('../db/connection');

exports.getStockAlerts = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.query(
      `SELECT 
        id,
        product_no,
        name AS product_name,
        stock,
        reorder_point
       FROM products
       WHERE is_deleted = FALSE
         AND stock <= reorder_point`
    );

    if (rows.length === 0) {
      return res.status(200).json({
        message: '✅ ไม่มีสินค้าที่ใกล้หมดในขณะนี้',
        alerts: []
      });
    }

    res.status(200).json({
      message: '📦 พบสินค้าที่ stock ใกล้หมดหรือต่ำกว่า reorder point',
      alerts: rows
    });

  } catch (error) {
    console.error('Error fetching stock alerts:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};
