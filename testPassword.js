const bcrypt = require('bcryptjs');

const inputPassword = 'password123'; // รหัสที่อยากทดสอบ
const hashFromDB = '$2b$10$cNLxNBZqj/R1OGyLGA1OVO4EsvlVHUgj1bIKGQthgkeSjG5ru970u'; // <<< ก็อป hash จาก DB จริง ๆ มาใส่ตรงนี้

bcrypt.compare(inputPassword, hashFromDB).then(isMatch => {
  console.log('ตรงไหม?', isMatch ? '✅ ตรง' : '❌ ไม่ตรง');
});
