// Serverless real-time messaging handler for Vercel
const messagesStore = new Map(); // conversationId -> Array of message objects
const conversationsStore = new Map(); // conversationId -> conversation object

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET conversations list if requested
  if (req.method === "GET" && req.query?.action === "conversations") {
    return res.status(200).json({ conversations: Array.from(conversationsStore.values()) });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const conversationId = body.conversationId;
      const senderId = body.senderId || "Student";
      const senderStudentId = body.senderStudentId || senderId;
      const content = body.content || "";
      const attachmentUrl = body.attachmentUrl || null;

      if (!conversationId) {
        return res.status(400).json({ success: false, error: "conversationId is required" });
      }

      const newMsg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        conversationId,
        senderId,
        senderStudentId,
        content,
        attachmentUrl,
        createdAt: new Date().toISOString()
      };

      if (!messagesStore.has(conversationId)) {
        messagesStore.set(conversationId, []);
      }

      const list = messagesStore.get(conversationId);
      list.push(newMsg);

      // Record/Update conversation entry
      const participantId = conversationId.replace(/^conv-/, "");
      conversationsStore.set(conversationId, {
        id: conversationId,
        otherUser: {
          id: participantId,
          studentId: participantId,
          section: ""
        },
        lastMessagePreview: attachmentUrl ? `[Attachment]` : content.substring(0, 80),
        lastMessageAt: newMsg.createdAt,
        unreadCount: 0
      });

      return res.status(200).json({ success: true, message: newMsg });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // GET request - fetch messages for conversationId
  const conversationId = req.query?.conversationId;
  if (!conversationId) {
    return res.status(200).json({ messages: [], conversations: Array.from(conversationsStore.values()) });
  }

  const list = messagesStore.get(conversationId) || [];
  return res.status(200).json({ messages: list });
};
