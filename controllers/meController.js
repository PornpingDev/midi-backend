const db = require('../db/connection');
const bcrypt = require('bcryptjs');

exports.changeMyPassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' });
    }

    const [rows] = await db.query('SELECT id, password FROM users WHERE id=?', [userId]);
    if (!rows.length) return res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });

    const user = rows[0];
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: 'รหัสผ่านเดิมไม่ถูกต้อง' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password=?, updated_at=NOW() WHERE id=?', [hashed, userId]);

    return res.json({ ok: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
};
