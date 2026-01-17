const connection = require("../db/connection");
const pool = require('../db/connection');


exports.getAllSuppliers = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id, 
        supplier_code AS code,
        name,
        address,
        phone,
        email,
        contact_person AS contactPerson,
        tax_id AS taxId,
        payment_due_date AS paymentDueDate,
        lead_time AS leadTime,
        note
      FROM suppliers
      WHERE is_deleted = FALSE OR is_deleted IS NULL
      ORDER BY id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ โหลด suppliers ล้มเหลว:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูล suppliers" });
  }
};

exports.createSupplier = async (req, res) => {
  const {
    supplier_code,
    name,
    address,
    phone,
    email,
    contactPerson,
    taxId,
    paymentDueDate,
    leadTime,
    note
  } = req.body;

  try {
    const [result] = await pool.query(
      `INSERT INTO suppliers (
        supplier_code, name, address, phone, email, contact_person,
        tax_id, payment_due_date, lead_time, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_code,
        name,
        address,
        phone,
        email,
        contactPerson,
        taxId,
        paymentDueDate,
        leadTime,
        note
      ]
    );

    res.status(201).json({ id: result.insertId, message: "เพิ่ม Supplier สำเร็จ" });
  } catch (err) {
    console.error("❌ เพิ่ม Supplier ล้มเหลว:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการเพิ่ม Supplier" });
  }
};





exports.updateSupplier = async (req, res) => {
  const { id } = req.params;
  const {
    supplier_code,
    name,
    address,
    phone,
    email,
    contactPerson,
    taxId,
    paymentDueDate,
    leadTime,
    note
  } = req.body;

  try {
    await pool.query(
      `UPDATE suppliers SET 
        supplier_code = ?, 
        name = ?, 
        address = ?, 
        phone = ?, 
        email = ?, 
        contact_person = ?, 
        tax_id = ?, 
        payment_due_date = ?, 
        lead_time = ?, 
        note = ?
      WHERE id = ?`,
      [
        supplier_code,
        name,
        address,
        phone,
        email,
        contactPerson,
        taxId,
        paymentDueDate,
        leadTime,
        note,
        id
      ]
    );

    res.json({ message: "อัปเดตข้อมูล Supplier เรียบร้อยแล้ว" });
  } catch (err) {
    console.error("❌ อัปเดต Supplier ล้มเหลว:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล Supplier" });
  }
};


exports.softDeleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE suppliers SET is_deleted = 1 WHERE id = ?', [id]);
    res.status(200).json({ message: 'ลบซัพพลายเออร์สำเร็จแบบ soft delete' });
  } catch (err) {
    console.error('❌ ลบ supplier ล้มเหลว:', err);
    res.status(500).json({ error: 'ลบ supplier ไม่สำเร็จ' });
  }
};
