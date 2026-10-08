//! Phase 11 tests: account provisioning and identity migration.
//!
//! These drive the real [`mmss_backend::provisioning`] code against a real SQLite
//! database and, where a login is involved, the real HTTP boundary over a real socket.
//! The import is the part of this system that creates identities, so the questions worth
//! asking are not "does it return 201" but:
//!
//!   * does running it twice create two of anything?
//!   * can a roster demote a teacher, or move a student between classes?
//!   * does a password appear anywhere it should not?
//!   * can a caller create an account by making a request?

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use mmss_backend::config::Config;
use mmss_backend::models::{NewUser, Role};
use mmss_backend::provisioning::{self, Report};
use mmss_backend::repositories::{credentials, teacher_classes, users};
use mmss_backend::services::auth::AuthService;
use mmss_backend::state::AppState;
use serde_json::json;
use sqlx::SqlitePool;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// A database, plus a scratch directory an operator's roster file would live in.
struct Fixture {
    db: SqlitePool,
    dir: PathBuf,
}

impl Fixture {
    /// A fresh database. The tag keeps parallel tests off each other's files.
    async fn new(tag: &str) -> Self {
        let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("mmss-r11-{}-{tag}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::new(Config::for_tests(format!(
            "sqlite://{}/mmss.db",
            dir.display()
        )))
        .await
        .unwrap();
        Self { db: state.db, dir }
    }

    /// Writes a roster and imports it, exactly as the CLI would.
    async fn import(&self, tag: &str, roster: &str) -> Report {
        let path = self.dir.join(format!("{tag}.csv"));
        std::fs::write(&path, roster).unwrap();
        provisioning::import_file(&self.db, &path).await.unwrap()
    }

    async fn user(&self, school_id: &str) -> mmss_backend::models::User {
        users::find_by_school_id(&self.db, school_id)
            .await
            .unwrap()
            .unwrap_or_else(|| panic!("no account {school_id}"))
    }

    async fn count(&self, table: &str) -> i64 {
        // `table` is a literal in every call site below, never caller-supplied.
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&self.db)
            .await
            .unwrap()
    }

    /// Every value stored in `credentials.password_hash`, for leak assertions.
    async fn hashes(&self) -> Vec<String> {
        sqlx::query_scalar("SELECT password_hash FROM credentials")
            .fetch_all(&self.db)
            .await
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// A small, valid roster used by most tests: one class, one subject, two students, a
/// teacher, and the teaching assignment.
fn roster() -> String {
    "\
kind,id,name,role,section,password,password_hash
class,9-A,,,,
subject,Mathematics,,,,
user,2026001,Aarav Sharma,student,9-A,do-not-log-me,
user,2026002,Bhavya Rao,student,9-A,,
user,t001,Ms Rao,teacher,,,
assignment,t001,,,9-A,,
"
    .to_owned()
}

// ------------------------------------------------------------ first run

/// A snapshot of every table an import writes to. One row per table so the idempotency
/// assertion is a single comparison rather than four.
async fn counts(db: &SqlitePool) -> (i64, i64, i64, i64) {
    let (users, classes, subjects, assignments): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM users),
                (SELECT COUNT(*) FROM classes),
                (SELECT COUNT(*) FROM subjects),
                (SELECT COUNT(*) FROM teacher_classes)",
    )
    .fetch_one(db)
    .await
    .unwrap();
    (users, classes, subjects, assignments)
}

/// The whole point of R11: one run of a roster produces the accounts, the class, the
/// subject and the teaching assignment.
#[tokio::test]
async fn a_first_import_provisions_the_whole_school_shape() {
    let fixture = Fixture::new("first").await;
    let report = fixture.import("first", &roster()).await;

    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.classes_created, 1);
    assert_eq!(report.subjects_created, 1);
    assert_eq!(report.users_created, 3);
    assert_eq!(report.assignments_created, 1);
    assert_eq!(report.applied(), 6);

    let student = fixture.user("2026001").await;
    assert_eq!(student.role, Role::Student);
    assert_eq!(student.display_name.as_deref(), Some("Aarav Sharma"));
    let class_id = student.class_id.expect("a student must land in a class");

    let class = mmss_backend::repositories::classes::find_by_id(&fixture.db, class_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(class.name, "9-A");

    // The school ID is stored exactly as the roster gave it, so it stays stable across
    // every later import and every login.
    assert_eq!(student.school_id, "2026001");

    // The teacher is staff: no class, teaching duty in the assignment table instead.
    let teacher = fixture.user("t001").await;
    assert_eq!(teacher.role, Role::Teacher);
    assert_eq!(teacher.class_id, None);
    assert!(teacher_classes::teaches(&fixture.db, teacher.id, class_id)
        .await
        .unwrap());

    // The second student landed in the same class row, not a second copy of it.
    let other = fixture.user("2026002").await;
    assert_eq!(other.class_id, Some(class_id));
    assert_eq!(fixture.count("classes").await, 1);
}

/// Every record kind works from any position in the file, so a school can sort its
/// spreadsheet by roll number and get the same database.
#[tokio::test]
async fn record_order_in_the_file_does_not_matter() {
    let sorted = "\
kind,id,name,role,section,password,password_hash
user,2026001,Aarav Sharma,student,9-A,,
assignment,t001,,,9-A,,
user,t001,Ms Rao,teacher,,,
class,9-A,,,,
subject,Mathematics,,,,
";
    let fixture = Fixture::new("order").await;
    let report = fixture.import("order", sorted).await;

    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.classes_created, 1);
    assert_eq!(report.users_created, 2);
    assert_eq!(report.assignments_created, 1);
}

// ------------------------------------------------------------ idempotency

/// The single most important property. Running the roster twice must leave the database
/// exactly as one run left it -- otherwise every retried import doubles a class.
#[tokio::test]
async fn a_second_import_creates_nothing_at_all() {
    let fixture = Fixture::new("idempotent").await;
    let first = fixture.import("idempotent", &roster()).await;
    assert!(first.is_clean(), "{first:?}");

    let before = counts(&fixture.db).await;
    let created_at: Vec<i64> =
        sqlx::query_scalar("SELECT created_at FROM users ORDER BY school_id")
            .fetch_all(&fixture.db)
            .await
            .unwrap();

    let second = fixture.import("idempotent", &roster()).await;

    assert!(second.is_clean(), "{second:?}");
    assert_eq!(
        second.applied(),
        0,
        "a rerun must write nothing: {second:?}"
    );
    assert_eq!(second.users_existing, 3);
    assert_eq!(second.classes_reused, 1);
    assert_eq!(second.subjects_reused, 1);
    assert_eq!(second.assignments_existing, 1);

    let after = counts(&fixture.db).await;
    assert_eq!(before, after);

    // Timestamps unchanged too: the rerun did not touch a single row.
    let after_created_at: Vec<i64> =
        sqlx::query_scalar("SELECT created_at FROM users ORDER BY school_id")
            .fetch_all(&fixture.db)
            .await
            .unwrap();
    assert_eq!(created_at, after_created_at);

    // A third run for good measure -- "idempotent" means once, not twice.
    let third = fixture.import("idempotent", &roster()).await;
    assert_eq!(third.applied(), 0);
}

/// A section named only on a student row is created, and a rerun reuses it rather than
/// making a near-duplicate class.
#[tokio::test]
async fn an_undeclared_section_is_created_once_and_then_reused() {
    let no_class_rows = "\
kind,id,name,role,section
user,2026001,Aarav,student,9-B
user,2026002,Bhavya,student,9-b
";
    let fixture = Fixture::new("undeclared").await;

    let first = fixture.import("undeclared", no_class_rows).await;
    assert!(first.is_clean(), "{first:?}");
    assert_eq!(first.classes_created, 1);
    assert_eq!(first.users_created, 2);

    // `9-b` is the same section written differently. Two classes would be a school with a
    // phantom section that half the application cannot see.
    assert_eq!(fixture.count("classes").await, 1);
    let a = fixture.user("2026001").await;
    let b = fixture.user("2026002").await;
    assert_eq!(a.class_id, b.class_id);

    let second = fixture.import("undeclared", no_class_rows).await;
    assert_eq!(second.classes_created, 0);
    assert_eq!(
        fixture.count("classes").await,
        1,
        "still exactly one section"
    );
    assert_eq!(fixture.count("users").await, 2);
}

// ---------------------------------------------------------- never overwrite

/// The core safety property. A roster that disagrees with the database is reported, and
/// the database wins. An import is not a migration and gets no authority to demote
/// anybody.
#[tokio::test]
async fn a_roster_never_overwrites_an_existing_account() {
    let fixture = Fixture::new("no-overwrite").await;
    fixture.import("no-overwrite", &roster()).await;

    // Promote the student to a teacher and give the teacher a name, out of band.
    let student = fixture.user("2026001").await;
    let teacher = fixture.user("t001").await;
    sqlx::query("UPDATE users SET role = 'teacher', display_name = 'Promoted' WHERE id = ?1")
        .bind(student.id)
        .execute(&fixture.db)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET display_name = 'Real Name' WHERE id = ?1")
        .bind(teacher.id)
        .execute(&fixture.db)
        .await
        .unwrap();

    // The same roster again, unchanged.
    let report = fixture.import("no-overwrite", &roster()).await;
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.users_existing, 3);
    assert_eq!(report.users_created, 0);

    assert_eq!(
        fixture.user("2026001").await.role,
        Role::Teacher,
        "a spreadsheet must not be able to demote a teacher back to a student"
    );
    assert_eq!(
        fixture.user("2026001").await.display_name.as_deref(),
        Some("Promoted")
    );
    assert_eq!(
        fixture.user("t001").await.display_name.as_deref(),
        Some("Real Name"),
        "and must not rename anybody either"
    );
}

/// A password already in use is not replaced by the roster's copy. This is what stops a
/// stale spreadsheet from locking every student out of an account they have since
/// changed the password on.
#[tokio::test]
async fn an_existing_password_is_never_replaced_by_the_roster() {
    let fixture = Fixture::new("preserve-password").await;
    fixture.import("preserve-password", &roster()).await;

    let user = fixture.user("2026001").await;
    let original = credentials::find_password_hash(&fixture.db, user.id)
        .await
        .unwrap()
        .unwrap();

    // The student changes their password.
    AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"))
        .set_password(user.id, "a-password-they-chose")
        .await
        .unwrap();
    let changed = credentials::find_password_hash(&fixture.db, user.id)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(original, changed);

    // Rerun the roster, which still carries the old one.
    let report = fixture.import("preserve-password", &roster()).await;
    assert_eq!(report.credentials_set, 0);
    assert_eq!(
        report.credentials_preserved, 1,
        "the roster's copy was not applied"
    );

    assert_eq!(
        credentials::find_password_hash(&fixture.db, user.id)
            .await
            .unwrap()
            .unwrap(),
        changed,
        "the password the student chose must survive the rerun"
    );
    // And it must still be the one that works.
    let service = AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"));
    assert!(service
        .authenticate("2026001", "a-password-they-chose")
        .await
        .is_ok());
    assert!(service
        .authenticate("2026001", "do-not-log-me")
        .await
        .is_err());
}

/// A credential for an account that has none is filled in. That is not an overwrite --
/// there is nothing to overwrite -- and it is how a student who was provisioned without
/// a password later gets one.
#[tokio::test]
async fn a_missing_credential_is_filled_in_but_never_replaced() {
    let without_passwords = "\
kind,id,name,role,section,password
class,9-A,,,,
user,2026001,Aarav,student,9-A,
";
    let fixture = Fixture::new("fill-credential").await;

    let first = fixture.import("fill", without_passwords).await;
    assert_eq!(first.users_created, 1);
    assert_eq!(first.credentials_set, 0);
    let user = fixture.user("2026001").await;
    assert!(
        credentials::find_password_hash(&fixture.db, user.id)
            .await
            .unwrap()
            .is_none(),
        "an account provisioned without a password has no credential, which is the safe \
         state for a password nobody has been handed yet"
    );
    assert!(
        AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"))
            .authenticate("2026001", "anything")
            .await
            .is_err(),
        "and it cannot be signed in to"
    );

    // Now the school supplies the password. A separate file rather than an appended row,
    // because a second row for the same ID in the same file is a duplicate, not an update.
    let with_password = "\
kind,id,name,role,section,password
class,9-A,,,,
user,2026001,Aarav,student,9-A,first-password
";
    let second = fixture.import("fill2", with_password).await;
    assert!(second.is_clean(), "{second:?}");
    assert_eq!(second.users_existing, 1);
    assert_eq!(second.credentials_set, 1);

    let service = AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"));
    assert!(service
        .authenticate("2026001", "first-password")
        .await
        .is_ok());

    // A third roster with a different password does not take effect.
    let third_source = "\
kind,id,name,role,section,password
class,9-A,,,,
user,2026001,Aarav,student,9-A,second-password
";
    let third = fixture.import("fill3", third_source).await;
    assert_eq!(third.credentials_preserved, 1);
    assert!(service
        .authenticate("2026001", "second-password")
        .await
        .is_err());
}

/// The bootstrapped administrator survives an import, and a roster row for the same
/// account does not demote it.
#[tokio::test]
async fn an_administrator_is_preserved_and_never_demoted_by_a_roster() {
    let fixture = Fixture::new("admin").await;

    // The same account `bootstrap::ensure_admin` creates.
    users::create(
        &fixture.db,
        &NewUser {
            school_id: "admin_mmss".into(),
            display_name: Some("Administrator".into()),
            role: Role::Admin,
            class_id: None,
        },
    )
    .await
    .unwrap();

    // A roster that lists the admin as a student. Note the blank section, so this is a
    // well-formed row -- it is the *role* that disagrees.
    let hostile = "\
kind,id,name,role,section,password
class,9-A,,,,
user,admin_mmss,Someone Else,student,9-A,
";
    let report = fixture.import("admin", hostile).await;
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.users_existing, 1);
    assert_eq!(report.users_created, 0);

    let admin = fixture.user("admin_mmss").await;
    assert_eq!(
        admin.role,
        Role::Admin,
        "an import must not demote an admin"
    );
    assert_eq!(admin.display_name.as_deref(), Some("Administrator"));
    assert_eq!(admin.class_id, None);
}

/// A roster may create an admin, but only an admin the school deliberately listed. The
/// database has no opinion about who should be an administrator; the roster is the
/// school's own statement, and this test pins that it is honoured rather than refused.
#[tokio::test]
async fn a_roster_can_provision_a_deliberate_administrator() {
    let fixture = Fixture::new("admin-create").await;
    let report = fixture
        .import(
            "admin-create",
            "kind,id,name,role,section,password,password_hash\nuser,admin_mmss,Administrator,admin,\n",
        )
        .await;
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(fixture.user("admin_mmss").await.role, Role::Admin);
}

// ---------------------------------------------------------- duplicate IDs

/// Two rows with the same school ID in one file. The first wins, the second is reported,
/// and no second account appears -- which matters because `UNIQUE` on `school_id` would
/// otherwise turn the second row into a hard failure of the whole import.
#[tokio::test]
async fn a_duplicate_school_id_in_one_file_is_refused_not_created() {
    let fixture = Fixture::new("dupe").await;
    let report = fixture
        .import(
            "dupe",
            "kind,id,name,role,section,password,password_hash\n\
             user,2026001,Aarav,student,9-A\n\
             user,2026001,Impostor,student,9-B\n",
        )
        .await;

    assert_eq!(report.users_created, 1);
    assert_eq!(report.rejected.len(), 1);
    assert!(report.rejected[0]
        .reason
        .contains("already uses this school ID"));
    assert!(
        report.rejected[0].reason.contains("(line 2)"),
        "the rejection names the earlier row it duplicates: {report:?}"
    );
    assert_eq!(fixture.count("users").await, 1);
    assert_eq!(
        fixture.user("2026001").await.display_name.as_deref(),
        Some("Aarav")
    );
}

/// The case-insensitive collision. `users.school_id` is UNIQUE under SQLite's binary
/// collation, so `2026A001` and `2026a001` are two perfectly legal rows -- and then
/// `AuthService` correctly refuses to answer a login for either one, because it cannot
/// tell which account is meant. Catching that here turns an account nobody can ever sign
/// in to into a line in a report.
#[tokio::test]
async fn a_school_id_differing_only_in_case_is_a_conflict_not_a_second_account() {
    let fixture = Fixture::new("case").await;
    fixture
        .import(
            "case",
            "kind,id,name,role,section,password,password_hash\nuser,2026A001,Aarav,student,9-A\n",
        )
        .await;

    let report = fixture
        .import(
            "case2",
            "kind,id,name,role,section,password,password_hash\nuser,2026a001,Impostor,student,9-A\n",
        )
        .await;

    assert_eq!(report.conflicts.len(), 1, "{report:?}");
    assert!(report.conflicts[0].reason.contains("differs only in case"));
    assert_eq!(report.users_created, 0);
    assert_eq!(fixture.count("users").await, 1);
    // The original spelling survives untouched -- the account that already existed is the
    // one that keeps the identity.
    assert_eq!(
        fixture.user("2026A001").await.display_name.as_deref(),
        Some("Aarav")
    );

    // And the ambiguity that would have followed is real: R3's case-insensitive lookup
    // resolves the other spelling to the *one* account that survived. Had both rows been
    // created it would have found two and refused to answer for either -- an account
    // nobody could ever sign in to.
    let folded =
        mmss_backend::repositories::users::find_by_school_id_ignore_case(&fixture.db, "2026a001")
            .await
            .unwrap()
            .expect("exactly one account, so the lookup resolves rather than refusing");
    assert_eq!(folded.school_id, "2026A001");
    assert_eq!(folded.display_name.as_deref(), Some("Aarav"));
}

/// Two school IDs that normalise to the same account -- the email form and the roll
/// number -- are the same person, and must not become two.
#[tokio::test]
async fn a_school_email_and_a_roll_number_are_the_same_account() {
    let fixture = Fixture::new("email").await;
    fixture
        .import(
            "email",
            "kind,id,name,role,section,password,password_hash\n\
             user,2026001@manavmangalschool.com,Aarav,student,9-A\n\
             user,2026001,Again,student,9-A\n",
        )
        .await;

    assert_eq!(fixture.count("users").await, 1);
    assert_eq!(
        fixture.user("2026001").await.display_name.as_deref(),
        Some("Aarav")
    );
}

// ------------------------------------------------------- invalid records

/// A malformed row stops the whole import before anything is written. A roster of three
/// thousand students with one typo in it should not be half applied and then corrected by
/// hand.
#[tokio::test]
async fn one_malformed_row_stops_the_whole_import() {
    let fixture = Fixture::new("malformed").await;
    let path = fixture.dir.join("bad.csv");
    std::fs::write(
        &path,
        "kind,id,name,role,section,password,password_hash\n\
         user,2026001,Aarav,student,9-A\n\
         user,,Nameless,student,9-A\n\
         user,2026002,Bhavya,studnet,9-A\n",
    )
    .unwrap();

    let error = provisioning::import_file(&fixture.db, &path)
        .await
        .unwrap_err()
        .to_string();

    assert!(error.contains("line 3"), "{error}");
    assert!(error.contains("`id` is required"), "{error}");
    assert!(error.contains("line 4"), "{error}");
    assert!(error.contains("unknown role"), "{error}");
    assert_eq!(fixture.count("users").await, 0, "nothing may be written");
}

/// Rows that parse but cannot be applied are reported one line each, and the rest of the
/// roster still lands. This is a different problem from a malformed file: the row is
/// well formed, it just disagrees with reality.
#[tokio::test]
async fn rows_that_disagree_with_reality_are_reported_and_the_rest_still_imports() {
    let fixture = Fixture::new("disagree").await;
    let report = fixture
        .import(
            "disagree",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             user,2026001,Aarav,student,9-A\n\
             user,t001,Ms Rao,teacher,,,\n\
             assignment,2026001,,,9-A,,\n\
             assignment,ghost,,,9-A,,\n\
             assignment,t001,,,9-Z,,\n",
        )
        .await;

    assert_eq!(report.users_created, 2);
    assert_eq!(report.rejected.len(), 3, "{report:?}");

    let reasons = report
        .rejected
        .iter()
        .map(|issue| issue.reason.as_str())
        .collect::<Vec<_>>()
        .join(" | ");
    assert!(reasons.contains("only a teacher"), "{reasons}");
    assert!(
        reasons.contains("no account with this school ID"),
        "{reasons}"
    );
    assert!(reasons.contains("no class or user row"), "{reasons}");
    assert!(!report.is_clean(), "the CLI must exit non-zero for this");
}

/// An assignment naming a section nothing declares is refused, because silently creating
/// a class here would let a typo invent a section.
#[tokio::test]
async fn an_assignment_to_an_unknown_section_is_refused() {
    let fixture = Fixture::new("unknown-section").await;
    let report = fixture
        .import(
            "unknown-section",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             user,t001,Ms Rao,teacher,,,\n\
             assignment,t001,,,9-Z,,\n",
        )
        .await;
    assert_eq!(report.rejected.len(), 1);
    assert!(report.rejected[0].reason.contains("no class or user row"));
    assert_eq!(report.assignments_created, 0);
}

/// Structural mistakes are refused at parse time.
#[tokio::test]
async fn structural_mistakes_are_refused() {
    for (roster, expected) in [
        (
            "kind,id,name,role,section,password,password_hash\nuser,t001,Ms Rao,teacher,9-A\n",
            "must not name a section",
        ),
        (
            "kind,id,name,role,section,password,password_hash\nuser,2026001,Aarav,student,\n",
            "must name a section",
        ),
        (
            // A class row with no label at all.
            "kind,id,name,role,section,password,password_hash\nclass,,,,,\n",
            "`id` is required",
        ),
        (
            "kind,id,name,role,section,password,password_hash\nbanana,,x,,,,\n",
            "unknown kind",
        ),
        (
            "kind,id,name,role,section,password,password_hash\n\
             user,2026001,Aarav,student,9-A,secret,\"$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA\"\n",
            "not both",
        ),
        (
            "kind,id,name,role,section,password_hash\nuser,2026001,Aarav,student,9-A,hunter2\n",
            "must be an argon2id PHC string",
        ),
        (
            // A typo'd header is how a whole column of names silently fails to import.
            "kind,id,displayname,role,section\nclass,9-A,,, \n",
            "displayname",
        ),
    ] {
        let fixture = Fixture::new("structural").await;
        let path = fixture.dir.join("s.csv");
        std::fs::write(&path, roster).unwrap();
        let error = provisioning::import_file(&fixture.db, &path)
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains(expected),
            "expected {expected:?} in:\n{error}\nfrom roster:\n{roster}"
        );
        assert_eq!(fixture.count("users").await, 0);
    }
}

// ------------------------------------------------------- credentials

/// The password is hashed, and it appears nowhere else. Not in the database, not in the
/// report.
#[tokio::test]
async fn a_password_is_hashed_and_stored_as_nothing_but_an_argon2id_phc_string() {
    const PASSWORD: &str = "correct-horse-battery-staple";
    let fixture = Fixture::new("hash").await;
    let report = fixture
        .import(
            "hash",
            &format!(
                "kind,id,name,role,section,password,password_hash\nuser,2026001,Aarav,student,9-A,{PASSWORD}\n"
            ),
        )
        .await;

    assert_eq!(report.credentials_set, 1);

    let hashes = fixture.hashes().await;
    assert_eq!(hashes.len(), 1);
    assert!(hashes[0].starts_with("$argon2id$"), "{}", hashes[0]);
    assert!(!hashes[0].contains(PASSWORD));
    assert!(
        !hashes[0].to_lowercase().contains(PASSWORD),
        "not even base64-ishly"
    );

    // And the plaintext is not anywhere in the database file. A hash in the right column
    // is not the same guarantee as a hash being the only thing in the file.
    let bytes = std::fs::read(fixture.dir.join("mmss.db")).unwrap();
    assert!(
        !contains(&bytes, PASSWORD.as_bytes()),
        "the plaintext password is present in the database file"
    );

    // The report does not carry it either.
    let serialised = serde_json::to_string(&report).unwrap();
    assert!(!contains(serialised.as_bytes(), PASSWORD.as_bytes()));
}

/// The whole point of hashing: the stored value is not the password, and the password is
/// what works.
#[tokio::test]
async fn the_hashed_credential_authenticates_and_the_plaintext_is_not_the_stored_value() {
    let fixture = Fixture::new("verify").await;
    fixture
        .import(
            "verify",
            "kind,id,name,role,section,password,password_hash\nuser,2026001,Aarav,student,9-A,the-real-password\n",
        )
        .await;

    let service = AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"));
    let principal = service
        .authenticate("2026001", "the-real-password")
        .await
        .unwrap();
    assert_eq!(principal.school_id, "2026001");

    assert!(service
        .authenticate("2026001", "The-Real-Password")
        .await
        .is_err());
    assert!(service.authenticate("2026001", "").await.is_err());
}

/// Two accounts with the same password get two different hashes. Identical hashes would
/// mean identical salts, which is the failure argon2's per-hash salt exists to prevent.
#[tokio::test]
async fn two_accounts_sharing_a_password_do_not_share_a_hash() {
    let fixture = Fixture::new("salt").await;
    fixture
        .import(
            "salt",
            "kind,id,name,role,section,password,password_hash\n\
             user,2026001,Aarav,student,9-A,a-shared-password\n\
             user,2026002,Bhavya,student,9-A,a-shared-password\n",
        )
        .await;

    let hashes = fixture.hashes().await;
    assert_eq!(hashes.len(), 2);
    assert_ne!(hashes[0], hashes[1], "each hash must carry its own salt");
}

/// A pre-hashed column lets the school hash offline, so the roster file itself never holds
/// something replayable.
#[tokio::test]
async fn a_prehashed_credential_is_stored_verbatim_and_authenticates() {
    let fixture = Fixture::new("prehashed").await;
    let password = "the-real-password";
    let phc = mmss_backend::services::auth::hash_password(password).unwrap();

    // Quoted, because a PHC string always contains commas in its parameter list
    // (`m=19456,t=2,p=1`) and an unquoted one would be read as several columns.
    let report = fixture
        .import(
            "prehashed",
            &format!(
                "kind,id,name,role,section,password_hash\nuser,2026001,Aarav,student,9-A,\"{phc}\"\n"
            ),
        )
        .await;
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(report.credentials_set, 1);

    let stored = fixture.hashes().await;
    assert_eq!(stored, vec![phc.clone()], "stored verbatim, not re-hashed");

    let service = AuthService::new(&fixture.db, &Config::for_tests("sqlite::memory:"));
    assert!(service.authenticate("2026001", password).await.is_ok());
}

/// Substring search over raw bytes, because the database file is a file and the plaintext
/// must be absent from all of it rather than from one column.
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

// --------------------------------------------------------- at school scale

/// The shape of the real thing: a whole school, imported in one run, at a size where a
/// per-row query would matter.
#[tokio::test]
async fn a_school_wide_roster_imports_in_one_run() {
    let fixture = Fixture::new("scale").await;

    let mut text = String::from("kind,id,name,role,section,password,password_hash\n");
    for section in ["9-A", "9-B", "9-C", "10-A"] {
        text.push_str(&format!("class,{section},,,,\n"));
    }
    const PER_SECTION: usize = 250;
    let expected_students = PER_SECTION * 4;
    for section in ["9-A", "9-B", "9-C", "10-A"] {
        for index in 0..PER_SECTION {
            let id = format!("{}-{:04}", section.replace('-', ""), index);
            text.push_str(&format!("user,{id},Student {index},student,{section}\n"));
        }
    }

    let started = std::time::Instant::now();
    let report = fixture.import("scale", &text).await;
    let elapsed = started.elapsed();

    assert!(
        report.is_clean(),
        "{:?}",
        &report.rejected[..report.rejected.len().min(3)]
    );
    assert_eq!(report.classes_created, 4);
    assert_eq!(report.users_created, expected_students);
    assert_eq!(fixture.count("users").await, expected_students as i64);

    // No per-row query blowup. The budget is generous -- it is here to catch an accidental
    // N+1 that turns a two-second import into a two-minute one, not to benchmark.
    assert!(
        elapsed.as_secs() < 60,
        "a {PER_SECTION}-student-per-section import took {elapsed:?}"
    );

    // And a rerun of the same file is still a no-op.
    let second = fixture.import("scale2", &text).await;
    assert_eq!(second.applied(), 0);
    assert_eq!(second.users_existing, expected_students);
}

// ------------------------------------------------------------ profile route

/// The login flow over a real socket, for an account that arrived through the roster
/// rather than through the bootstrap.
#[tokio::test]
async fn a_provisioned_account_signs_in_and_uses_the_existing_apis() {
    let fixture = Fixture::new("e2e").await;
    fixture
        .import(
            "e2e",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             subject,Mathematics,,,,\n\
             user,2026001,Aarav Sharma,student,9-A,student-password\n\
             user,t001,Ms Rao,teacher,,teacher-password\n\
             assignment,t001,,,9-A,,\n",
        )
        .await;

    // Give the teacher something to create, through the real repository the API uses.
    // Config only reaches the AuthService for the session TTL, so the same value serves
    // both here and on the boundary below.
    let config = Config::for_tests("sqlite::memory:");
    let teacher_session = AuthService::new(&fixture.db, &config)
        .authenticate("t001", "teacher-password")
        .await
        .unwrap();
    let subject_id = sqlx::query_scalar::<_, i64>("SELECT id FROM subjects LIMIT 1")
        .fetch_one(&fixture.db)
        .await
        .unwrap();
    let class_id = sqlx::query_scalar::<_, i64>("SELECT id FROM classes LIMIT 1")
        .fetch_one(&fixture.db)
        .await
        .unwrap();
    // Written through the same service the teacher API uses, so the homework under test is
    // one a real teacher could have created.
    mmss_backend::services::teacher_homework::TeacherHomeworkService::new(&fixture.db)
        .create(
            &teacher_session,
            &mmss_backend::api::CreateHomeworkBody {
                class_id,
                subject_id,
                due_date: "2026-11-02".into(),
                homework: Some("Exercises 1-12.".into()),
                classwork: None,
                attachments: Vec::new(),
            },
        )
        .await
        .unwrap();

    // Now the real boundary. This exercises the cookie, the session table, the argon2
    // credential the roster created, and the class scoping the roster established.
    let server = Boundary::start("e2e", &fixture.db).await;

    let login = server.login("2026001", "student-password").await;
    assert_eq!(login.status, 200, "{}", login.body);
    let session = login.cookie.clone().expect("a usable cookie");
    assert_eq!(login.json()["user"]["studentId"], "2026001");
    assert_eq!(login.json()["user"]["section"], "9-A");

    let me = server
        .send("GET", "/api/auth/me", Some(&session), None)
        .await;
    assert_eq!(me.status, 200);
    assert_eq!(me.json()["user"]["displayName"], "Aarav Sharma");

    // The student's feed is scoped to the class the roster put them in.
    let feed = server
        .send("GET", "/api/homework", Some(&session), None)
        .await;
    assert_eq!(feed.status, 200, "{}", feed.body);
    assert_eq!(feed.json()["count"], 1);
    assert_eq!(feed.json()["homework"][0]["homework"], "Exercises 1-12.");

    // Notes and progress work for them, and only for them.
    let homework_id = feed.json()["homework"][0]["id"].as_i64().unwrap();
    assert_eq!(
        server
            .send(
                "PATCH",
                &format!("/api/homework/{homework_id}/status"),
                Some(&session),
                Some(json!({ "completed": true }))
            )
            .await
            .status,
        200
    );
    assert_eq!(
        server
            .send(
                "POST",
                &format!("/api/notes/homework/{homework_id}"),
                Some(&session),
                Some(json!({ "body": "a note" }))
            )
            .await
            .status,
        200
    );
}

// ------------------------------------------------------------ HTTP boundary

/// The same TCP harness R10 uses. Re-declared rather than shared because a test binary
/// cannot import from another test binary, and pulling it into `lib.rs` would put an HTTP
/// client in production code for the sake of tests.
mod boundary {
    use std::net::SocketAddr;

    use serde_json::Value;

    pub struct Reply {
        pub status: u16,
        pub body: String,
        pub cookie: Option<String>,
    }

    impl Reply {
        pub fn json(&self) -> Value {
            serde_json::from_str(&self.body)
                .unwrap_or_else(|_| panic!("expected JSON, got {}: {}", self.status, self.body))
        }
    }

    pub struct Boundary {
        pub addr: SocketAddr,
    }

    impl Boundary {
        pub async fn start(_tag: &str, db: &sqlx::SqlitePool) -> Self {
            let state = mmss_backend::state::AppState {
                db: db.clone(),
                config: Config::for_tests("sqlite::memory:"),
            };
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let app = mmss_backend::app(state);
            tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            Self { addr }
        }

        /// One request, with a cookie jar kept the way a browser keeps one.
        pub async fn send(
            &self,
            method: &str,
            path: &str,
            session: Option<&str>,
            body: Option<Value>,
        ) -> Reply {
            let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
            request.push_str("Accept: application/json\r\n");
            if let Some(token) = session {
                request.push_str(&format!("Cookie: app_session={token}\r\n"));
            }
            let body = body.map(|value| value.to_string());
            if let Some(text) = &body {
                request.push_str("Content-Type: application/json\r\n");
                request.push_str(&format!("Content-Length: {}\r\n", text.len()));
            }
            request.push_str("Connection: close\r\n\r\n");
            if let Some(text) = &body {
                request.push_str(text);
            }

            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut stream = tokio::net::TcpStream::connect(self.addr).await.unwrap();
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut raw = Vec::new();
            stream.read_to_end(&mut raw).await.unwrap();
            let text = String::from_utf8_lossy(&raw).into_owned();
            let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));

            let status = head
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|code| code.parse().ok())
                .unwrap_or(0);
            let cookie = head
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.trim().eq_ignore_ascii_case("set-cookie"))
                .and_then(|(_, value)| {
                    let pair = value.trim().split(';').next()?;
                    Some(pair.split_once('=')?.1.trim().to_owned())
                });

            Reply {
                status,
                body: body.to_owned(),
                cookie,
            }
        }

        /// The login the frontend performs.
        pub async fn login(&self, school_id: &str, password: &str) -> Reply {
            self.send(
                "POST",
                "/api/auth/login",
                None,
                Some(serde_json::json!({
                    "studentId": school_id,
                    "password": password
                })),
            )
            .await
        }
    }

    use super::Config;
}

use boundary::Boundary;

/// `PATCH /api/auth/profile` — the route R11 completes because `AppShell` prompts a
/// student with no display name to set one, and until now that produced a 404.
#[tokio::test]
async fn a_provisioned_student_can_set_their_own_display_name() {
    let fixture = Fixture::new("profile").await;
    fixture
        .import(
            "profile",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             user,2026001,,student,9-A,student-password\n",
        )
        .await;

    let server = Boundary::start("profile", &fixture.db).await;
    let login = server.login("2026001", "student-password").await;
    assert_eq!(login.status, 200, "{}", login.body);
    let session = login.cookie.clone().unwrap();

    let updated = server
        .send(
            "PATCH",
            "/api/auth/profile",
            Some(&session),
            Some(json!({ "displayName": "Aarav S." })),
        )
        .await;
    assert_eq!(updated.status, 200, "{}", updated.body);
    // The response is the whole account, because the client rebuilds its session state
    // from it through `mapAuthUser`.
    let user = &updated.json()["user"];
    assert_eq!(user["displayName"], "Aarav S.");
    assert_eq!(user["studentId"], "2026001");
    assert_eq!(user["section"], "9-A");
    assert_eq!(user["isAdmin"], false);

    // It sticks, and it survives a fresh session.
    let me = server
        .send("GET", "/api/auth/me", Some(&session), None)
        .await;
    assert_eq!(me.json()["user"]["displayName"], "Aarav S.");
    assert_eq!(
        fixture.user("2026001").await.display_name.as_deref(),
        Some("Aarav S.")
    );

    // A blank name is refused rather than stored: an empty name is what the client is
    // asking the user to replace, and writing it makes the prompt reappear with no way out.
    for blank in ["", "   "] {
        let refused = server
            .send(
                "PATCH",
                "/api/auth/profile",
                Some(&session),
                Some(json!({ "displayName": blank })),
            )
            .await;
        assert_eq!(refused.status, 400, "{blank:?} -> {}", refused.body);
        assert!(refused.json()["error"]
            .as_str()
            .unwrap()
            .contains("displayName"));
    }

    // An over-long name is refused.
    let long = server
        .send(
            "PATCH",
            "/api/auth/profile",
            Some(&session),
            Some(json!({ "displayName": "x".repeat(500) })),
        )
        .await;
    assert_eq!(long.status, 400);
}

/// The name is the caller's own and nobody else's. There is no field anywhere in this API
/// that names another account, so there is no second door for this route to leave open.
#[tokio::test]
async fn a_profile_update_can_only_ever_touch_the_callers_own_account() {
    let fixture = Fixture::new("profile-authz").await;
    fixture
        .import(
            "profile-authz",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             user,2026001,Aarav,student,9-A,student-password\n\
             user,2026002,Bhavya,student,9-A,other-password\n\
             user,t001,Ms Rao,teacher,,teacher-password\n\
             user,admin_mmss,Administrator,admin,,admin-password\n",
        )
        .await;

    let server = Boundary::start("profile-authz", &fixture.db).await;

    // Anonymous: no session at all.
    let anonymous = server
        .send(
            "PATCH",
            "/api/auth/profile",
            None,
            Some(json!({ "displayName": "Intruder" })),
        )
        .await;
    assert_eq!(anonymous.status, 401);

    // Every role may rename *itself*. There is no admin-only variant, because there is no
    // admin feature here to gate.
    for (school_id, password) in [
        ("2026001", "student-password"),
        ("2026002", "other-password"),
        ("t001", "teacher-password"),
        ("admin_mmss", "admin-password"),
    ] {
        let session = server
            .login(school_id, password)
            .await
            .cookie
            .clone()
            .unwrap();
        let reply = server
            .send(
                "PATCH",
                "/api/auth/profile",
                Some(&session),
                Some(json!({ "displayName": format!("Renamed {school_id}") })),
            )
            .await;
        assert_eq!(reply.status, 200, "{school_id}: {}", reply.body);
        assert_eq!(
            fixture.user(school_id).await.display_name.as_deref(),
            Some(format!("Renamed {school_id}").as_str())
        );
    }

    // A body naming somebody else changes nobody. `userId`, `id`, `role` and `schoolId`
    // are simply not deserializable fields, so they are ignored rather than honoured --
    // and the write still lands on the caller.
    let session = server
        .login("2026001", "student-password")
        .await
        .cookie
        .clone()
        .unwrap();
    let before = fixture.user("2026002").await.display_name.clone();
    let reply = server
        .send(
            "PATCH",
            "/api/auth/profile",
            Some(&session),
            Some(json!({
                "displayName": "Aarav Renamed",
                "userId": fixture.user("2026002").await.id,
                "id": fixture.user("2026002").await.id,
                "schoolId": "2026002",
                "role": "admin",
                "classId": 999,
            })),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["user"]["studentId"], "2026001");
    assert_eq!(reply.json()["user"]["role"], "student");
    assert_eq!(
        fixture.user("2026002").await.display_name,
        before,
        "another account must not be touched"
    );
    assert_eq!(fixture.user("2026002").await.role, Role::Student);
    assert_eq!(fixture.user("2026001").await.role, Role::Student);
    assert_eq!(
        fixture.user("2026001").await.class_id,
        fixture.user("2026002").await.class_id,
        "and a supplied classId must not move the caller between classes"
    );

    // A malformed body is a clean 400, not axum's 422 with a parser message.
    let malformed = server
        .send(
            "PATCH",
            "/api/auth/profile",
            Some(&session),
            Some(json!({ "displayName": 42 })),
        )
        .await;
    assert_eq!(malformed.status, 400, "{}", malformed.body);
    assert_eq!(malformed.json()["code"], "BAD_REQUEST");
}

/// Account creation has no HTTP surface at all. There is no route that takes a roster, no
/// route that takes a student ID and makes an account, and no way for an unauthenticated
/// caller to cause one to exist.
#[tokio::test]
async fn no_request_can_create_an_account() {
    let fixture = Fixture::new("no-http-provision").await;
    let server = Boundary::start("no-http-provision", &fixture.db).await;

    // Every plausible spelling of "make me an account", with and without a session.
    let session = server
        .login("admin_mmss", "x")
        .await
        .cookie
        .unwrap_or_default();

    let bodies = [
        json!({ "schoolId": "2026001", "password": "p" }),
        json!({ "studentId": "2026001", "password": "p" }),
        json!({ "users": [{ "schoolId": "2026001" }] }),
        json!({ "role": "admin", "schoolId": "2026001" }),
    ];
    let paths = [
        "/api/users",
        "/api/auth/users",
        "/api/auth/register",
        "/api/auth/provision",
        "/api/admin/users",
        "/api/admin/students",
        "/api/import",
        "/api/provision",
    ];

    for path in paths {
        for method in ["POST", "PUT"] {
            for body in &bodies {
                let anonymous = server.send(method, path, None, Some(body.clone())).await;
                assert_eq!(
                    anonymous.status, 404,
                    "{method} {path} must not exist, got {}",
                    anonymous.status
                );
                let with_session = server
                    .send(method, path, Some(&session), Some(body.clone()))
                    .await;
                assert!(
                    with_session.status == 404 || with_session.status == 401,
                    "{method} {path} as a session: {}",
                    with_session.status
                );
                assert_ne!(
                    with_session.status, 201,
                    "{method} {path} created an account"
                );
            }
        }
    }

    assert_eq!(
        fixture.count("users").await,
        0,
        "no request may have produced an account"
    );
    assert_eq!(fixture.count("credentials").await, 0);
}

/// A roster is not reachable through the running service: the import is a CLI path, and
/// the process that serves requests never reads a file.
#[tokio::test]
async fn the_import_subcommand_is_not_an_http_route() {
    let fixture = Fixture::new("cli-only").await;
    let server = Boundary::start("cli-only", &fixture.db).await;
    for path in [
        "/api/import",
        "/import",
        "/api/provision",
        "/provision",
        "/api/roster",
    ] {
        let reply = server
            .send("POST", path, None, Some(json!({ "roster": "a,b,c" })))
            .await;
        assert_eq!(reply.status, 404, "{path}");
        // The 404 speaks the documented envelope, so a client can tell it apart.
        assert_eq!(reply.json()["code"], "NOT_FOUND");
    }
}

/// The credential boundary the old system did not have: an account provisioned with no
/// password exists and is authorised, but cannot sign in. This is the state a student is
/// in between being enrolled and being handed a password.
#[tokio::test]
async fn an_account_with_no_credential_exists_but_cannot_sign_in() {
    let fixture = Fixture::new("no-credential").await;
    fixture
        .import(
            "no-credential",
            "kind,id,name,role,section,password,password_hash\n\
             class,9-A,,,,\n\
             subject,Mathematics,,,,\n\
             user,2026001,Aarav,student,9-A\n\
             user,t001,Ms Rao,teacher,,teacher-password\n\
             assignment,t001,,,9-A,,\n",
        )
        .await;

    // The account is real and the assignment is real.
    let student = fixture.user("2026001").await;
    assert!(student.class_id.is_some());
    let teacher = fixture.user("t001").await;
    assert!(
        teacher_classes::teaches(&fixture.db, teacher.id, student.class_id.unwrap())
            .await
            .unwrap()
    );

    // But signing in is refused, with the same answer as any wrong credential -- so
    // "provisioned without a password" is not a distinguishable state to a caller.
    let server = Boundary::start("no-credential", &fixture.db).await;
    for password in ["anything", "2026001", "correct-horse"] {
        let reply = server.login("2026001", password).await;
        assert_eq!(reply.status, 401, "{password:?}");
        assert_eq!(reply.json()["authenticated"], false);
    }
    let wrong = server.login("t001", "wrong").await;
    let missing = server.login("2026001", "anything").await;
    assert_eq!(
        wrong.json()["error"],
        missing.json()["error"],
        "an account with no credential must be indistinguishable from a wrong password"
    );
}
