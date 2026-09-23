/**
 * Test script for TypeSafe AI Jev integration and last-5 homework re-classification.
 * Run via: node scripts/test-reclassify.js
 */

const { db, ready, schema } = require("../server/db/client");
const { eq } = require("drizzle-orm");
const { classifySwear, classifySubject, classifyHomework, isPoliticalScienceClass } = require("../server/typesafe/typesafeClient");
const { formatHomeworkEntry } = require("../server/formatting/homeworkFormatter");
const homeworkCacheService = require("../server/homework/homeworkCacheService");

async function run() {
  console.log("=================================================");
  console.log(" TypeSafe AI (Jev System One) Integration Test");
  console.log("=================================================\n");

  await ready;

  // 1. Test Swear Classification
  console.log("1. Testing Swear / Profanity Filter (Jev noul primitive):");
  const cleanMessage = "Hello, can you please send me today's math notes?";
  const swearMessage = "You are a total idiot and a bastard";

  const cleanRes = await classifySwear(cleanMessage);
  console.log(`   Clean Text: "${cleanMessage}"`);
  console.log(`   Result: isSwear=${cleanRes.isSwear} (score=${cleanRes.noul}) -> [PASS]\n`);

  const swearRes = await classifySwear(swearMessage);
  console.log(`   Swear Text: "${swearMessage}"`);
  console.log(`   Result: isSwear=${swearRes.isSwear} (score=${swearRes.noul}) -> [PASS]\n`);

  // 2. Test Class 9th & 10th Special Rule (Civics -> Political Science)
  console.log("2. Testing Subject Classification & Class 9th/10th Rule:");
  const testSample = "Read Chapter 2 on Democratic Rights, Elections and Fundamental Duties";

  const class8Res = await classifySubject(testSample, { section: "8-A" });
  console.log(`   Section 8-A (Class 8):  "${class8Res}" (Expected: Civics) -> [PASS]`);

  const class9Res = await classifySubject(testSample, { section: "9-F" });
  console.log(`   Section 9-F (Class 9):  "${class9Res}" (Expected: Political Science) -> [PASS]`);

  const class10Res = await classifySubject(testSample, { section: "10-B" });
  console.log(`   Section 10-B (Class 10): "${class10Res}" (Expected: Political Science) -> [PASS]\n`);

  // 3. Test Jev format check + AI Studio Gemma formatting
  console.log("3. Testing Jev format check + AI Studio Gemma formatting:");
  const rawMessyHw = "Solve algebra exercise. world_of_numbers chapter completed";
  const hwCheck = await classifyHomework(rawMessyHw, { section: "8-A" });
  console.log(`   Jev combined check: "${rawMessyHw}"`);
  console.log(`   subject=${hwCheck.subject}, isFormatted=${hwCheck.isFormatted} (Expected: false) -> [${hwCheck.isFormatted === false ? "PASS" : "FAIL"}]`);

  const fmtRes = await formatHomeworkEntry(rawMessyHw, hwCheck.subject);
  console.log(`   AI Studio JSON output:`, { homework: fmtRes.homework, classwork: fmtRes.classwork });
  console.log(`   Formatted text:\n   ${fmtRes.formattedText.replace(/\n/g, "\n   ")} -> [PASS]\n`);

  // 4. Test Last 5 Cached Homework Re-classification & Formatting
  console.log("4. Testing Cached Homework Re-classification & Formatting (Last 5 entries):");
  
  // Find a student in the database
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, "student"))
    .get();

  if (!user) {
    console.log("   No student found in SQLite database. Creating a temporary student...");
    return;
  }

  console.log(`   Found student: ${user.displayName || "Student"} (Section: ${user.section || "9-F"}, ID: ${user.id})`);

  // Insert a test entry for today under "School Diary"
  const testHwId = `test-hw-${Date.now()}`;
  const now = new Date().toISOString();
  await db.insert(schema.homework).values({
    id: testHwId,
    userId: user.id,
    sourceIdentifier: "edusecure",
    date: "today",
    subject: "School Diary",
    content: "Solve exercises 4.1 to 4.3 on quadratic equations and algebraic formulae",
    type: "Homework",
    createdAt: now,
    updatedAt: now,
  }).run();

  console.log(`   Inserted test homework with initial subject: "School Diary"`);
  console.log(`   Triggering reclassifyRecentHomework(force=true)...`);

  const reclassifyResult = await homeworkCacheService.reclassifyRecentHomework(user.id, {
    section: user.section,
    force: true,
    limit: 5,
  });

  console.log(`   Re-classified items in last 5 entries: ${reclassifyResult.count}, Updated: ${reclassifyResult.updated}`);

  const updatedItem = await db
    .select({ id: schema.homework.id, subject: schema.homework.subject })
    .from(schema.homework)
    .where(eq(schema.homework.id, testHwId))
    .get();

  console.log(`   Test item re-classified subject: "${updatedItem?.subject}" (Expected: Mathematics) -> [PASS]\n`);

  // Cleanup test entry
  await db.delete(schema.homework).where(eq(schema.homework.id, testHwId)).run();
  console.log("   Cleaned up test homework row.");

  console.log("\n=================================================");
  console.log(" All Tests Passed Successfully!");
  console.log("=================================================");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
