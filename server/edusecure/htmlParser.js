const cheerio = require("cheerio");

/**
 * Parses raw HTML string from EduSecure Announcement page into structured homework objects.
 * @param {string} html Raw HTML content
 * @param {string} targetUrl Base URL for resolving relative attachment links
 * @returns {Array<{type: string, date: string, homework: string, attachment: string|null}>}
 */
function parseHomeworkHtml(html, targetUrl = "https://edusecure.in/ManavMangalMohali/ParentApp/Announcement.aspx?Type=Homework") {
  if (!html) return [];

  const $ = cheerio.load(html);
  const homework = [];

  $("#ctl00_ContentPlaceHolder1_grdDashContents tr").each((index, row) => {
    const entry = $(row);

    const type = entry
      .find('[id$="_lbltype"]')
      .text()
      .trim();

    const date = entry
      .find("small")
      .first()
      .text()
      .trim();

    const paragraph = entry.find("p").first();

    const homeworkText = paragraph
      .clone()
      .children("b")
      .remove()
      .end()
      .text()
      .trim();

    const attachment = entry
      .find('[id$="_HyperLink1"]')
      .attr("href");

    if (homeworkText) {
      let resolvedAttachment = null;
      if (attachment) {
        try {
          resolvedAttachment = new URL(attachment, targetUrl).href;
        } catch {
          resolvedAttachment = attachment;
        }
      }

      homework.push({
        type: type || "Homework",
        date: date || "",
        homework: homeworkText,
        attachment: resolvedAttachment
      });
    }
  });

  return homework;
}

module.exports = {
  parseHomeworkHtml
};
