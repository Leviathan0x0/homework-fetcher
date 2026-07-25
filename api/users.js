// Serverless user directory handler for Vercel
const registeredUsersMap = new Map();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const studentId = (body.studentId || "").trim();
      const id = body.id || studentId;
      const section = body.section || "";

      if (studentId) {
        registeredUsersMap.set(studentId.toLowerCase(), {
          id,
          studentId,
          section
        });
      }
      return res.status(200).json({ success: true, registeredCount: registeredUsersMap.size });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // GET request - search registered users
  const q = (req.query?.q || "").trim().toLowerCase();
  const allUsers = Array.from(registeredUsersMap.values());

  if (!q) {
    return res.status(200).json({ users: allUsers });
  }

  const matches = allUsers.filter(u => u.studentId.toLowerCase().includes(q));
  return res.status(200).json({ users: matches });
};
