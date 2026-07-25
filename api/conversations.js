// Serverless conversations handler for Vercel
const conversationsMap = new Map(); // conversationId -> conversation object

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
      const conversationId = body.conversationId;
      const lastMessagePreview = body.lastMessagePreview || "Started a new conversation";
      const lastMessageAt = body.lastMessageAt || new Date().toISOString();

      if (conversationId) {
        conversationsMap.set(conversationId, {
          id: conversationId,
          lastMessagePreview,
          lastMessageAt,
          unreadCount: 0
        });
      }
      return res.status(200).json({ success: true, count: conversationsMap.size });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // GET request - fetch all active conversations
  const allConvs = Array.from(conversationsMap.values());
  return res.status(200).json({ conversations: allConvs });
};
