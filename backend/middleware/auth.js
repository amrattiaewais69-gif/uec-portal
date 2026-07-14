const jwt = require('jsonwebtoken');
const pool = require('../config/database');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function checkPermission(section, action) {
  return async (req, res, next) => {
    try {
      const username = req.user.username;
      if (!username) return res.status(403).json({ error: 'No user context' });

      const result = await pool.query('SELECT permissions, role FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(403).json({ error: 'User not found' });

      const user = result.rows[0];

      // Admin with null permissions OR empty permissions = full access
      if (user.role === 'admin' && (!user.permissions || Object.keys(user.permissions).length === 0)) return next();

      const perms = user.permissions;
      if (!perms) return res.status(403).json({ error: 'No permissions configured' });

      const sectionPerms = perms[section];
      if (!sectionPerms || !Array.isArray(sectionPerms)) {
        return res.status(403).json({ error: 'Access denied to ' + section });
      }

      if (!sectionPerms.includes(action)) {
        return res.status(403).json({ error: 'Missing permission: ' + section + '.' + action });
      }

      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { authenticateToken, requireRole, checkPermission };
