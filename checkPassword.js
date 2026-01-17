const bcrypt = require('bcryptjs');

bcrypt.hash('password123', 10).then(hash => {
  console.log('รหัสที่เข้ารหัสแล้ว:', hash);
});
