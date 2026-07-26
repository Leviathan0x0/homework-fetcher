const express = require("express");
const router = express.Router();

/**
 * POST /api/homework/ai-format
 * Formats raw homework text using Google Gemini API (or fallback rule-based parser).
 */
router.post("/homework/ai-format", async (req, res) => {
  try {
    const { text, subject } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'text' parameter." });
    }

    const apiKey = process.env.GEMINI_API_KEY || "AIzaSyAC2yCB85reyDtBOWLV6v6o0qMl6eyUOpo";
    const primaryModel = process.env.GEMINI_MODEL || "gemma-4-26b-a4b-it";
    const modelsToTry = Array.from(new Set([primaryModel, "gemini-1.5-flash", "gemini-2.0-flash"]));

    // Fallback parser function if AI key is missing or API fails
    const runFallback = () => {
      const isExam = /(?:test|exam|unit\s*test|eval|evaluation|pt|ut)/i.test(text);

      // Extract basic action items using simple line splitting
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const actionItems = lines
        .filter(l => /(?:do|complete|solve|write|learn|revise|bring|read)/i.test(l))
        .map(l => l.replace(/^(?:[\d+|[a-zA-Z]][\.\)]|[\-\*•])\s*/, ""));

      return {
        formattedClassWork: null,
        formattedHomeWork: text,
        summary: lines[0] ? lines[0].slice(0, 60) : "Homework entry",
        isExam,
        actionItems: actionItems.length > 0 ? actionItems : [text.slice(0, 80)],
        isAi: false
      };
    };

    if (!apiKey) {
      return res.json(runFallback());
    }

    // System prompt for structured JSON formatting
    const systemPrompt = `You are an expert AI assistant for a student homework app.
Your task is to convert raw, messy homework text into clean, structured Markdown for a student dashboard.

Return strictly a JSON object with the following fields:
- "formattedClassWork": (string or null) Markdown formatted classwork text if any topics/exercises were done in class.
- "formattedHomeWork": (string) Clean Markdown formatted homework text. Use bold for chapters, exercises, page numbers, question numbers, and notebook names. Use bullet points (- ) for tasks.
- "summary": (string) Short 1-sentence action summary for the card header (max 10 words).
- "isExam": (boolean) true if this entry mentions an upcoming test, unit test, or exam.
- "actionItems": (array of strings) Clean, actionable sub-tasks for students to check off.

Subject context: ${subject || "General"}
Raw text to format:
"""
${text}
"""
Respond strictly with valid JSON. No markdown codeblock wrappers, no explanations.`;

    let candidateText = null;
    let usedModel = null;

    for (const model of modelsToTry) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (extractedText) {
            candidateText = extractedText;
            usedModel = model;
            break;
          }
        } else {
          console.warn(`Model ${model} returned error status: ${response.status}`);
        }
      } catch (e) {
        console.warn(`Failed to call model ${model}:`, e.message);
      }
    }

    if (!candidateText) {
      return res.json(runFallback());
    }

    try {
      // Clean up markdown code block wrapping if model outputs ```json ... ```
      let cleanedJsonStr = candidateText.trim();
      if (cleanedJsonStr.startsWith("```")) {
        cleanedJsonStr = cleanedJsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      }

      const parsed = JSON.parse(cleanedJsonStr);
      return res.json({
        formattedClassWork: parsed.formattedClassWork || null,
        formattedHomeWork: parsed.formattedHomeWork || text,
        summary: parsed.summary || "Homework entry",
        isExam: Boolean(parsed.isExam),
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        isAi: true,
        modelUsed: usedModel
      });
    } catch (parseErr) {
      console.warn("Failed to parse Gemini JSON response:", parseErr);
      return res.json(runFallback());
    }
  } catch (err) {
    console.error("Error in /api/homework/ai-format:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
