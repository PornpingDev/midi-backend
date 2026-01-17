const db = require('../db/connection');
const bcrypt = require('bcryptjs');
const pool = require('../db/connection');

//  POST /users
exports.createUser = async (req, res) => {
  try {
    const {
      employee_code,
      name,
      phone,
      email,
      password,
      position,
      salary,
      role,
    } = req.body;

    //  เช็คว่ามี email ซ้ำหรือยัง
    const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email นี้มีอยู่ในระบบแล้ว' });
    }

    //  เข้ารหัส password ด้วย bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    //  Insert ลง database
    const [result] = await db.query(
      `INSERT INTO users (employee_code, name, phone, email, password, position, salary, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [employee_code, name, phone, email, hashedPassword, position, salary, role]
    );

    res.status(201).json({ message: 'เพิ่มผู้ใช้สำเร็จ', userId: result.insertId });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดบางอย่าง' });
  }
};




exports.getAllUsers = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE is_deleted = FALSE');
    res.status(200).json(rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงรายชื่อผู้ใช้' });
  }
};


exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const {
    employee_code,
    name,
    phone,
    email,
    password,
    position,
    salary,
    role
  } = req.body;

  try {
    await pool.query(
      'UPDATE users SET employee_code=?, name=?, phone=?, email=?, password=?, position=?, salary=?, role=? WHERE id=?',
      [employee_code, name, phone, email, password, position, salary, role, id]
    );
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
};


exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE users SET is_deleted = TRUE WHERE id = ?', [id]);
    res.json({ message: 'ลบผู้ใช้เรียบร้อย (Soft Delete)' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'ลบผู้ใช้ไม่สำเร็จ' });
  }
};


exports.getLastEmployeeCode = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT employee_code FROM users 
      ORDER BY id DESC 
      LIMIT 1
    `);

    const lastCode = rows.length > 0 ? rows[0].employee_code : null;
    res.status(200).json({ lastCode });
  } catch (error) {
    console.error('Get last employee code error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงรหัสพนักงานล่าสุด' });
  }
};

exports.resetPassword = async (req, res) => {
  const { id } = req.params;

  try {
    const hashedPassword = await bcrypt.hash('password123', 10);

    await db.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ? AND is_deleted = FALSE',
      [hashedPassword, id]
    );

    res.json({ message: 'Reset password success' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Reset password failed' });
  }
};
