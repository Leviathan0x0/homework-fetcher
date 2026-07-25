const cheerio = require("cheerio");

const LOGIN_URL = "https://edusecure.in/ManavMangalMohali/ParentApp/Login.aspx";
const HOMEWORK_URL = "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Homework";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractCookies(setCookieHeaders, existingCookieMap = new Map()) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return existingCookieMap;
  for (const header of setCookieHeaders) {
    if (!header) continue;
    const firstPart = header.split(";")[0];
    const equalIdx = firstPart.indexOf("=");
    if (equalIdx !== -1) {
      const key = firstPart.slice(0, equalIdx).trim();
      const val = firstPart.slice(equalIdx + 1).trim();
      if (val) existingCookieMap.set(key, val);
    }
  }
  return existingCookieMap;
}

function mapToCookieString(cookieMap) {
  const parts = [];
  for (const [k, v] of cookieMap.entries()) {
    if (v) parts.push(`${k}=${v}`);
  }
  return parts.join("; ");
}

async function loginAndFetchHomework(studentId, password) {
  const cookieMap = new Map();

  const getRes = await fetch(LOGIN_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  const getSetCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
  extractCookies(getSetCookies, cookieMap);

  const html = await getRes.text();
  const $ = cheerio.load(html);

  const viewState = $("#__VIEWSTATE").val() || "";
  const viewStateGen = $("#__VIEWSTATEGENERATOR").val() || "";
  const eventVal = $("#__EVENTVALIDATION").val() || "";

  if (!viewState) {
    throw new Error("Unable to load EduSecure login form.");
  }

  const sessionOptions = ["2026-2027", "2025-2026"];
  $("#drpSession option").each((_, el) => {
    const val = $(el).val();
    if (val && !sessionOptions.includes(val)) sessionOptions.push(val);
  });

  let homeworkList = [];

  for (const sessionYear of sessionOptions) {
    try {
      const trialCookieMap = new Map(cookieMap);
      const params = new URLSearchParams();
      params.append("__EVENTTARGET", "");
      params.append("__EVENTARGUMENT", "");
      params.append("__VIEWSTATE", viewState);
      if (viewStateGen) params.append("__VIEWSTATEGENERATOR", viewStateGen);
      if (eventVal) params.append("__EVENTVALIDATION", eventVal);
      params.append("drpSession", sessionYear);
      params.append("txtusername", studentId.trim());
      params.append("txtpassword", password);
      params.append("btnLogin", "Login");

      const postCookieHeader = mapToCookieString(trialCookieMap);

      const postRes = await fetch(LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": postCookieHeader,
          "User-Agent": USER_AGENT,
          "Referer": LOGIN_URL
        },
        body: params.toString(),
        redirect: "manual"
      });

      const postSetCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [];
      extractCookies(postSetCookies, trialCookieMap);

      const finalCookieString = mapToCookieString(trialCookieMap);

      const homeworkRes = await fetch(HOMEWORK_URL, {
        headers: {
          "Cookie": finalCookieString,
          "User-Agent": USER_AGENT
        },
        redirect: "manual"
      });

      const homeworkHtml = await homeworkRes.text();

      if (homeworkHtml.includes("txtusername") || homeworkHtml.includes("Login.aspx")) {
        continue;
      }

      const $hw = cheerio.load(homeworkHtml);
      $hw("#ctl00_ContentPlaceHolder1_grdDashContents tr").each((_, row) => {
        const entry = $hw(row);
        const type = entry.find('[id$="_lbltype"]').text().trim();
        const date = entry.find("small").first().text().trim();
        const paragraph = entry.find("p").first();
        const homeworkText = paragraph.clone().children("b").remove().end().text().trim();
        const attachment = entry.find('[id$="_HyperLink1"]').attr("href");

        if (homeworkText) {
          homeworkList.push({
            id: `hw-${homeworkList.length + 1}`,
            type: type || "School Diary",
            date: date || new Date().toISOString().split("T")[0],
            subject: type || "General",
            homework: homeworkText,
            attachment: attachment ? new URL(attachment, HOMEWORK_URL).href : null,
            completed: false
          });
        }
      });

      if (homeworkList.length > 0) {
        break;
      }
    } catch (e) {
      console.warn("Session attempt error:", e);
    }
  }

  return homeworkList;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let studentId = "student2";
    let password = "123456";

    if (req.body) {
      try {
        const parsed = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        if (parsed.studentId) studentId = parsed.studentId;
        if (parsed.password) password = parsed.password;
      } catch {}
    }

    if (req.query?.studentId) studentId = req.query.studentId;
    if (req.query?.password) password = req.query.password;

    const homework = await loginAndFetchHomework(studentId, password);
    return res.status(200).json({ success: true, count: homework.length, homework });
  } catch (err) {
    console.error("Homework Scraper API Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch school portal homework" });
  }
};
