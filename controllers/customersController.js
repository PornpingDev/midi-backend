const db = require('../db/connection');

exports.getAllCustomers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        customer_no AS code,
        name,
        address,
        phone,
        email,
        tax_id,
        billing_date,
        payment_due_date,
        note
      FROM customers
      WHERE is_deleted = FALSE
      ORDER BY id ASC
    `);
    res.status(200).json(rows);
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการดึงข้อมูลลูกค้า:', error);
    res.status(500).json({ message: 'ไม่สามารถโหลดข้อมูลลูกค้าได้' });
  }
};


exports.createCustomer = async (req, res) => {
  try {
    const {
      customer_no,
      name,
      address,
      phone,
      email,
      tax_id,
      billing_date,
      payment_due_date,
      note
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO customers
      (customer_no, name, address, phone, email, tax_id, billing_date, payment_due_date, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer_no, name, address, phone, email, tax_id, billing_date, payment_due_date, note]
    );

    const [newCustomer] = await db.query('SELECT * FROM customers WHERE id = ?', [result.insertId]);
    res.status(201).json(newCustomer[0]);
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเพิ่มลูกค้า' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_no,
      name,
      address,
      phone,
      email,
      tax_id,
      billing_date,
      payment_due_date,
      note
    } = req.body;

    await db.query(
      `UPDATE customers SET
        customer_no = ?, name = ?, address = ?, phone = ?, email = ?,
        tax_id = ?, billing_date = ?, payment_due_date = ?, note = ?
      WHERE id = ?`,
      [customer_no, name, address, phone, email, tax_id, billing_date, payment_due_date, note, id]
    );

    const [updated] = await db.query('SELECT * FROM customers WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแก้ไขลูกค้า' });
  }
};


exports.softDeleteCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE customers SET is_deleted = TRUE WHERE id = ?', [id]);
    res.status(200).json({ message: 'ลบลูกค้าแล้ว (soft delete)' });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบลูกค้า' });
  }
};