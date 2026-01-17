// middleware/authn.js

exports.authenticate = (req, res, next) => {
  try {
    const user = req.session && req.session.user;
    if (!user || !user.id) {
      return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
    }
    req.user = user; // เผื่อใช้ใน controller
    next();
  } catch (e) {
    next(e);
  }
};

exports.requireRole = (...roles) => {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าถึง' });
    }
    next();
  };
};
