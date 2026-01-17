exports.requireRole = (roles) => (req, res, next) => {
  const role = (req.session?.user?.role || '').toLowerCase();
  if (!roles.includes(role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  }
  next();
};
