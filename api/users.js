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
  const rawQ = (req.query?.q || "").trim();
  const q = rawQ.toLowerCase();
  const allUsers = Array.from(registeredUsersMap.values());

  if (!q) {
    return res.status(200).json({ users: allUsers });
  }

  let matches = allUsers.filter(u => u.studentId.toLowerCase().includes(q));

  // If exact or typed query isn't in memory yet, dynamically include it as a valid student user match
  if (matches.length === 0 && rawQ.length >= 2) {
    const newUser = { id: rawQ, studentId: rawQ, section: "" };
    registeredUsersMap.set(q, newUser);
    matches = [newUser];
  }

  return res.status(200).json({ users: matches });
};
