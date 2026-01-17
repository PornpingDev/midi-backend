const db = require('../db/connection');
const bcrypt = require('bcryptjs');

// POST /auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'กรอก email และ password' });
  }

  try {
    const [[user]] = await db.query(
      'SELECT id, email, password, role, name, employee_code, is_deleted FROM users WHERE email = ? LIMIT 1',
      [String(email).toLowerCase()]
    );

    // ไม่บอกรายละเอียด (อีเมล/รหัสผ่าน) เพื่อความปลอดภัย
    if (!user || user.is_deleted) return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

    // ✅ สร้างสถานะล็อกอินไว้ใน Session (cookie-session จะเซ็นคุกกี้ให้เอง)
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,                 // 'admin' | 'sales' | 'stock' | 'report'
      name: user.name || null,
      employee_code: user.employee_code || null,
    };

    // ส่งข้อมูลย่อกลับให้ FE โชว์ได้
    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
  }
};

// GET /auth/me
exports.me = (req, res) => {
  if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
  res.json({ user: req.session.user });
};

// POST /auth/logout
exports.logout = (req, res) => {
  req.session = null; // เคลียร์คุกกี้ session
  res.json({ ok: true });
};
