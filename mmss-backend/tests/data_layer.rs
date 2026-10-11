//! Integration tests for the real data layer: real migrations, real pool, real
//! repository code.
//!
//! Every test gets its own SQLite file in a unique temp directory, so the
//! development database under `data/` is never touched and tests never share
//! state or contend on the same file.

use std::sync::atomic::{AtomicU32, Ordering};

use mmss_backend::config::Config;
use mmss_backend::models::{
    NewAttachment, NewClass, NewHomework, NewNote, NewSubject, NewUser, Role,
};
use mmss_backend::repositories::{
    attachments, classes, homework, notes, progress, subjects, users,
};
use mmss_backend::state::AppState;
use sqlx::SqlitePool;

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// A path to a not-yet-created SQLite file, unique per call so tests never share
/// a database and each run starts from nothing.
fn temp_db_url(tag: &str) -> String {
    let unique = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("mmss-test-{}-{tag}-{unique}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    format!("sqlite://{}/mmss.db", dir.display())
}

fn config(database_url: String) -> Config {
    Config::for_tests(database_url)
}

/// Boots the application state the way `main` does, against a fresh database.
async fn fresh_state(tag: &str) -> AppState {
    AppState::new(config(temp_db_url(tag)))
        .await
        .expect("startup against an empty directory should succeed")
}

async fn pool(tag: &str) -> SqlitePool {
    fresh_state(tag).await.db
}

/// A class, a subject, a teacher and a student: the smallest world every other
/// test needs.
struct Fixture {
    class_id: i64,
    subject_id: i64,
    other_subject_id: i64,
    teacher_id: i64,
    student_id: i64,
}

async fn fixture(pool: &SqlitePool) -> Fixture {
    let class = classes::create(pool, &NewClass::new("9-F")).await.unwrap();
    let subject = subjects::create(pool, &NewSubject::new("Mathematics"))
        .await
        .unwrap();
    let other = subjects::create(pool, &NewSubject::new("Physics"))
        .await
        .unwrap();

    let teacher = users::create(
        pool,
        &NewUser {
            school_id: "teacher_test".into(),
            display_name: Some("Test Teacher".into()),
            role: Role::Teacher,
            class_id: None,
        },
    )
    .await
    .unwrap();

    let student = users::create(
        pool,
        &NewUser {
            school_id: "guranshbir126".into(),
            display_name: Some("Guranshbir Singh".into()),
            role: Role::Student,
            class_id: Some(class.id),
        },
    )
    .await
    .unwrap();

    Fixture {
        class_id: class.id,
        subject_id: subject.id,
        other_subject_id: other.id,
        teacher_id: teacher.id,
        student_id: student.id,
    }
}

fn entry(fx: &Fixture, due_date: &str, homework: &str) -> NewHomework {
    NewHomework {
        class_id: fx.class_id,
        subject_id: fx.subject_id,
        author_id: None,
        due_date: due_date.into(),
        homework_text: Some(homework.into()),
        classwork_text: None,
    }
}

// ---------------------------------------------------------------- initialise

#[tokio::test]
async fn empty_directory_initialises_database_and_schema() {
    let state = fresh_state("init").await;
    let db = &state.db;

    // The database file exists on disk...
    let file: String = sqlx::query_scalar("SELECT file FROM pragma_database_list")
        .fetch_one(db)
        .await
        .unwrap();
    assert!(file.ends_with("mmss.db"), "unexpected database file {file}");

    // ...the migrations are recorded...
    let applied: Vec<String> = sqlx::query_scalar(
        "SELECT description FROM _sqlx_migrations WHERE success = 1 ORDER BY version",
    )
    .fetch_all(db)
    .await
    .unwrap();
    // Adding a migration is a deliberate edit here, as the comment in `state.rs`
    // says: R5 added `teacher classes`, R7 added `edusecure publications`.
    assert_eq!(
        applied,
        [
            "initial schema",
            "auth",
            "teacher classes",
            "edusecure publications",
            "account lifecycle",
            "account security"
        ]
    );

    // ...and every table the data layer needs is queryable.
    let tables: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(db)
            .await
            .unwrap();
    for expected in [
        "account_events",
        "attachments",
        "classes",
        "edusecure_credentials",
        "homework",
        "homework_progress",
        "notes",
        "setup_tokens",
        "subjects",
        "teacher_classes",
        "users",
    ] {
        assert!(tables.contains(&expected.to_string()), "missing {expected}");
    }
}

#[tokio::test]
async fn starting_twice_reuses_the_initialised_database() {
    let url = temp_db_url("restart");
    let first = AppState::new(config(url.clone())).await.unwrap();
    // Write a row so a second process that silently recreated the file would be
    // caught rather than passing on an empty schema.
    classes::create(&first.db, &NewClass::new("9-C"))
        .await
        .unwrap();
    drop(first);

    let second = AppState::new(config(url)).await.unwrap();
    assert_eq!(classes::list(&second.db).await.unwrap().len(), 1);

    let applied: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
        .fetch_one(&second.db)
        .await
        .unwrap();
    assert_eq!(applied, 6, "migrations must not be reapplied");
}

#[tokio::test]
async fn foreign_keys_are_enforced() {
    let db = pool("fk").await;
    let enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(enabled, 1, "pool must open with foreign keys on");
}

// -------------------------------------------------------------- constraints

#[tokio::test]
async fn homework_requires_a_known_class_subject_and_day() {
    let db = pool("hw-fk").await;
    let fx = fixture(&db).await;

    let bad_class = homework::create(
        &db,
        &NewHomework {
            class_id: 999_999,
            ..entry(&fx, "2026-07-23", "x")
        },
    )
    .await;
    assert!(bad_class.is_err(), "unknown class must be rejected");

    let bad_subject = homework::create(
        &db,
        &NewHomework {
            subject_id: 999_999,
            ..entry(&fx, "2026-07-23", "x")
        },
    )
    .await;
    assert!(bad_subject.is_err(), "unknown subject must be rejected");

    let bad_date = homework::create(&db, &entry(&fx, "Jul 23, 2026", "x")).await;
    assert!(bad_date.is_err(), "display-string date must be rejected");
}

#[tokio::test]
async fn homework_keeps_homework_and_classwork_separate() {
    let db = pool("split").await;
    let fx = fixture(&db).await;

    let both = homework::create(
        &db,
        &NewHomework {
            homework_text: Some("Chapter 4 questions".into()),
            classwork_text: Some("Exercise 6.1".into()),
            ..entry(&fx, "2026-07-23", "ignored")
        },
    )
    .await
    .unwrap();
    assert_eq!(both.homework_text.as_deref(), Some("Chapter 4 questions"));
    assert_eq!(both.classwork_text.as_deref(), Some("Exercise 6.1"));

    // Either half alone is a valid entry; the one that was not supplied is NULL
    // rather than an empty string.
    let only_homework = homework::create(&db, &entry(&fx, "2026-07-24", "Read pages 10-20"))
        .await
        .unwrap();
    assert!(only_homework.classwork_text.is_none());

    let only_classwork = homework::create(
        &db,
        &NewHomework {
            homework_text: None,
            classwork_text: Some("Worksheet 3".into()),
            ..entry(&fx, "2026-07-25", "ignored")
        },
    )
    .await
    .unwrap();
    assert!(only_classwork.homework_text.is_none());

    // An entry with neither half has nothing to show and is rejected.
    let empty = homework::create(
        &db,
        &NewHomework {
            homework_text: None,
            classwork_text: None,
            ..entry(&fx, "2026-07-26", "x")
        },
    )
    .await;
    assert!(empty.is_err(), "an entry with no text must be rejected");

    let blank = homework::create(
        &db,
        &NewHomework {
            homework_text: Some("   ".into()),
            classwork_text: None,
            ..entry(&fx, "2026-07-27", "x")
        },
    )
    .await;
    assert!(blank.is_err(), "a blank entry must be rejected");
}

#[tokio::test]
async fn unique_identifiers_are_enforced() {
    let db = pool("unique").await;
    let fx = fixture(&db).await;

    assert!(
        users::create(&db, &NewUser::student("guranshbir126", fx.class_id))
            .await
            .is_err()
    );
    assert!(classes::create(&db, &NewClass::new("9-F")).await.is_err());
    assert!(subjects::create(&db, &NewSubject::new("Mathematics"))
        .await
        .is_err());

    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();
    notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(hw.id),
            body: "bring register".into(),
        },
    )
    .await
    .unwrap();

    // One note per user per entry...
    assert!(notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(hw.id),
            body: "again".into()
        },
    )
    .await
    .is_err());

    // ...but a different student may have their own note on the same entry.
    let other = users::create(&db, &NewUser::student("student2", fx.class_id))
        .await
        .unwrap();
    assert!(notes::create(
        &db,
        &NewNote {
            user_id: other.id,
            homework_id: Some(hw.id),
            body: "mine too".into()
        },
    )
    .await
    .is_ok());

    // The same tick twice is an upsert, not a duplicate.
    let first = progress::set_completed(&db, fx.student_id, hw.id, true)
        .await
        .unwrap();
    let second = progress::set_completed(&db, fx.student_id, hw.id, false)
        .await
        .unwrap();
    assert_eq!(first.id, second.id);
    assert!(!second.completed);
    assert_eq!(
        progress::list_by_user(&db, fx.student_id)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn school_id_is_stored_verbatim_and_finds_exactly_one_user() {
    let db = pool("school-id").await;
    let fx = fixture(&db).await;

    let found = users::find_by_school_id(&db, "guranshbir126")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.id, fx.student_id);
    assert_eq!(
        found.school_id, "guranshbir126",
        "school id must not be normalised"
    );
    assert_eq!(found.role, Role::Student);
    assert_eq!(found.class_id, Some(fx.class_id));

    // Internal key and external identifier are separate concerns.
    assert_ne!(found.id, 0);
    assert!(users::find_by_school_id(&db, "Guranshbir126")
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        users::find_by_id(&db, fx.student_id).await.unwrap(),
        Some(found)
    );
}

// ------------------------------------------------------------------ crud

#[tokio::test]
async fn users_classes_and_subjects_round_trip() {
    let db = pool("crud-lookup").await;
    let fx = fixture(&db).await;

    let class = classes::find_by_id(&db, fx.class_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(class.name, "9-F");
    assert_eq!(
        classes::find_by_name(&db, "9-F").await.unwrap(),
        Some(class.clone())
    );
    assert!(classes::find_by_name(&db, "9-Z").await.unwrap().is_none());
    // Renaming keeps the row, so homework still points at the same class.
    let renamed = classes::rename(&db, fx.class_id, "9-G")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.id, class.id);
    assert_eq!(renamed.name, "9-G");
    assert!(renamed.updated_at >= class.updated_at);

    let subject = subjects::find_by_id(&db, fx.subject_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(subject.name, "Mathematics");
    assert_eq!(
        subjects::find_by_name(&db, "Physics")
            .await
            .unwrap()
            .unwrap()
            .id,
        fx.other_subject_id
    );
    assert_eq!(subjects::list(&db).await.unwrap().len(), 2);

    let student = users::find_by_id(&db, fx.student_id)
        .await
        .unwrap()
        .unwrap();
    let renamed_user = users::update_display_name(&db, student.id, Some("G. Singh"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed_user.display_name.as_deref(), Some("G. Singh"));
    assert_eq!(renamed_user.school_id, student.school_id);
    // A partial update that supplies no name leaves the existing one alone.
    let untouched = users::update_display_name(&db, student.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(untouched.display_name.as_deref(), Some("G. Singh"));
}

#[tokio::test]
async fn homework_crud_and_filtering() {
    let db = pool("hw-crud").await;
    let fx = fixture(&db).await;

    let older = homework::create(
        &db,
        &NewHomework {
            author_id: Some(fx.teacher_id),
            homework_text: Some("Algebra exercise 4.2".into()),
            classwork_text: Some("Long division".into()),
            ..entry(&fx, "2026-07-20", "ignored")
        },
    )
    .await
    .unwrap();
    let newer = homework::create(
        &db,
        &NewHomework {
            subject_id: fx.other_subject_id,
            ..entry(&fx, "2026-07-23", "Optics notes")
        },
    )
    .await
    .unwrap();
    let middle = homework::create(&db, &entry(&fx, "2026-07-22", "Trigonometry"))
        .await
        .unwrap();

    assert_eq!(
        homework::find_by_id(&db, older.id).await.unwrap(),
        Some(older.clone())
    );
    assert!(homework::find_by_id(&db, 999_999).await.unwrap().is_none());

    // by class, newest school day first
    let by_class = homework::list(
        &db,
        &homework::Filter {
            class_id: Some(fx.class_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        by_class.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![newer.id, middle.id, older.id]
    );

    // by subject
    let by_subject = homework::list(
        &db,
        &homework::Filter {
            subject_id: Some(fx.other_subject_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(by_subject.len(), 1);
    assert_eq!(by_subject[0].id, newer.id);

    // by day, and by day range
    let by_day = homework::list(
        &db,
        &homework::Filter {
            due_from: Some("2026-07-23".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        by_day.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![newer.id]
    );

    let by_range = homework::list(
        &db,
        &homework::Filter {
            due_from: Some("2026-07-21".into()),
            due_to: Some("2026-07-22".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        by_range.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![middle.id]
    );

    // class + subject together: the dashboard's combined filter
    let combined = homework::list(
        &db,
        &homework::Filter {
            class_id: Some(fx.class_id),
            subject_id: Some(fx.subject_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        combined.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![middle.id, older.id]
    );

    // by author, and a limit
    let authored = homework::list(
        &db,
        &homework::Filter {
            author_id: Some(fx.teacher_id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        authored.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![older.id]
    );

    let limited = homework::list(
        &db,
        &homework::Filter {
            class_id: Some(fx.class_id),
            limit: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(limited.len(), 2);

    // update: subject, day and both texts are replaced
    let updated = homework::update(
        &db,
        older.id,
        fx.other_subject_id,
        "2026-07-19",
        Some("Algebra exercise 4.3"),
        Some("Long division"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(updated.subject_id, fx.other_subject_id);
    assert_eq!(updated.due_date, "2026-07-19");
    assert_eq!(
        updated.homework_text.as_deref(),
        Some("Algebra exercise 4.3")
    );
    assert_eq!(updated.classwork_text.as_deref(), Some("Long division"));
    assert!(updated.updated_at >= older.updated_at);
    assert!(
        updated.created_at == older.created_at,
        "created_at must not move"
    );
    assert!(
        homework::update(&db, 999_999, fx.subject_id, "2026-07-19", None, None)
            .await
            .unwrap()
            .is_none()
    );

    // One half can be cleared, and comes back as NULL rather than an empty string
    let cleared = homework::update(
        &db,
        older.id,
        fx.other_subject_id,
        "2026-07-19",
        None,
        Some("Long division"),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        cleared.homework_text.is_none(),
        "a cleared half is NULL, not an empty string"
    );

    // ...but clearing both would leave an entry with nothing to show
    assert!(
        homework::update(&db, older.id, fx.subject_id, "2026-07-19", None, None)
            .await
            .is_err()
    );

    // delete
    assert!(homework::delete(&db, middle.id).await.unwrap());
    assert!(!homework::delete(&db, middle.id).await.unwrap());
    assert!(homework::find_by_id(&db, middle.id)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn attachments_are_metadata_only_and_hang_off_homework() {
    let db = pool("attach").await;
    let fx = fixture(&db).await;
    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();

    let pdf = attachments::create(
        &db,
        &NewAttachment {
            homework_id: hw.id,
            filename: "chapter-4.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 204_800,
            storage_key: "homework/2026/07/chapter-4.pdf".into(),
        },
    )
    .await
    .unwrap();
    let photo = attachments::create(
        &db,
        &NewAttachment {
            homework_id: hw.id,
            filename: "blackboard.jpg".into(),
            mime_type: "image/jpeg".into(),
            size_bytes: 90_000,
            storage_key: "homework/2026/07/blackboard.jpg".into(),
        },
    )
    .await
    .unwrap();

    let listed = attachments::list_by_homework(&db, hw.id).await.unwrap();
    assert_eq!(listed, vec![pdf.clone(), photo.clone()]);
    assert_eq!(
        attachments::find_by_id(&db, pdf.id).await.unwrap(),
        Some(pdf.clone())
    );
    assert_eq!(pdf.filename, "chapter-4.pdf");
    assert_eq!(pdf.size_bytes, 204_800);

    // An entry with no attachment is legal, and one attachment cannot hang off
    // an entry that does not exist.
    let bare = homework::create(&db, &entry(&fx, "2026-07-24", "Read pages"))
        .await
        .unwrap();
    assert!(attachments::list_by_homework(&db, bare.id)
        .await
        .unwrap()
        .is_empty());
    assert!(attachments::create(
        &db,
        &NewAttachment {
            homework_id: 999_999,
            filename: "ghost.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 1,
            storage_key: "ghost.pdf".into(),
        },
    )
    .await
    .is_err());

    // Metadata rows carry no file bytes: nothing but the declared columns.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('attachments') ORDER BY cid")
            .fetch_all(&db)
            .await
            .unwrap();
    assert_eq!(
        columns,
        [
            "id",
            "homework_id",
            "filename",
            "mime_type",
            "size_bytes",
            "storage_key",
            "created_at"
        ]
    );

    assert!(attachments::delete(&db, pdf.id).await.unwrap());
    assert!(!attachments::delete(&db, pdf.id).await.unwrap());
    assert_eq!(
        attachments::list_by_homework(&db, hw.id).await.unwrap(),
        vec![photo]
    );
}

#[tokio::test]
async fn notes_attach_to_a_user_and_optionally_an_entry() {
    let db = pool("notes").await;
    let fx = fixture(&db).await;
    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();
    let other_hw = homework::create(&db, &entry(&fx, "2026-07-24", "Optics"))
        .await
        .unwrap();

    let on_entry = notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(hw.id),
            body: "bring register".into(),
        },
    )
    .await
    .unwrap();
    let on_other = notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(other_hw.id),
            body: "lab notebook".into(),
        },
    )
    .await
    .unwrap();
    let about_me = notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: None,
            body: "maths tuition on friday".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(on_entry.user_id, fx.student_id);
    assert_eq!(on_entry.homework_id, Some(hw.id));
    assert_eq!(about_me.homework_id, None);

    assert_eq!(
        notes::find_for_homework(&db, fx.student_id, hw.id)
            .await
            .unwrap(),
        Some(on_entry.clone())
    );
    assert!(notes::find_for_homework(&db, fx.teacher_id, hw.id)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        notes::find_by_id(&db, on_entry.id).await.unwrap(),
        Some(on_entry.clone())
    );

    // Three notes for one user, and none visible to another user.
    assert_eq!(
        notes::list_by_user(&db, fx.student_id).await.unwrap().len(),
        3
    );
    assert!(notes::list_by_user(&db, fx.teacher_id)
        .await
        .unwrap()
        .is_empty());

    let edited = notes::update(&db, on_entry.id, "bring register + calculator")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(edited.body, "bring register + calculator");
    assert!(edited.created_at == on_entry.created_at);
    assert!(
        notes::update(&db, on_entry.id, "   ").await.is_err(),
        "a blank note is rejected"
    );

    assert!(notes::delete(&db, on_other.id).await.unwrap());
    assert!(!notes::delete(&db, on_other.id).await.unwrap());
    assert_eq!(
        notes::list_by_user(&db, fx.student_id).await.unwrap().len(),
        2
    );

    // A note cannot point at a user or an entry that does not exist.
    assert!(notes::create(
        &db,
        &NewNote {
            user_id: 999_999,
            homework_id: None,
            body: "ghost".into()
        },
    )
    .await
    .is_err());
    assert!(notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(999_999),
            body: "ghost".into()
        },
    )
    .await
    .is_err());
}

#[tokio::test]
async fn progress_defaults_to_unticked_and_upserts() {
    let db = pool("progress").await;
    let fx = fixture(&db).await;
    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();

    // No row at all means not completed, so nothing is written until the
    // student actually ticks.
    assert!(progress::find(&db, fx.student_id, hw.id)
        .await
        .unwrap()
        .is_none());

    let ticked = progress::set_completed(&db, fx.student_id, hw.id, true)
        .await
        .unwrap();
    assert!(ticked.completed);
    assert_eq!(ticked.homework_id, hw.id);
    assert!(progress::find(&db, fx.student_id, hw.id)
        .await
        .unwrap()
        .is_some());
    assert_eq!(
        progress::list_by_user(&db, fx.student_id)
            .await
            .unwrap()
            .len(),
        1
    );

    let unticked = progress::set_completed(&db, fx.student_id, hw.id, false)
        .await
        .unwrap();
    assert!(!unticked.completed);
    assert_eq!(unticked.id, ticked.id);

    // Ticking needs a real user and a real entry.
    assert!(progress::set_completed(&db, 999_999, hw.id, true)
        .await
        .is_err());
    assert!(progress::set_completed(&db, fx.student_id, 999_999, true)
        .await
        .is_err());

    assert!(progress::delete(&db, fx.student_id, hw.id).await.unwrap());
    assert!(!progress::delete(&db, fx.student_id, hw.id).await.unwrap());
}

// -------------------------------------------------------------- deletion

#[tokio::test]
async fn deleting_an_entry_removes_its_dependent_metadata() {
    let db = pool("cascade").await;
    let fx = fixture(&db).await;
    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();

    let attachment = attachments::create(
        &db,
        &NewAttachment {
            homework_id: hw.id,
            filename: "worksheet.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 4_096,
            storage_key: "homework/worksheet.pdf".into(),
        },
    )
    .await
    .unwrap();
    let note = notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(hw.id),
            body: "remember".into(),
        },
    )
    .await
    .unwrap();
    progress::set_completed(&db, fx.student_id, hw.id, true)
        .await
        .unwrap();

    assert!(homework::delete(&db, hw.id).await.unwrap());

    // Nothing survives that would point at an entry that no longer exists.
    assert!(attachments::find_by_id(&db, attachment.id)
        .await
        .unwrap()
        .is_none());
    assert!(notes::find_by_id(&db, note.id).await.unwrap().is_none());
    assert!(progress::find(&db, fx.student_id, hw.id)
        .await
        .unwrap()
        .is_none());
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn deleting_a_class_or_subject_in_use_is_refused() {
    let db = pool("restrict").await;
    let fx = fixture(&db).await;
    let hw = homework::create(&db, &entry(&fx, "2026-07-23", "Chapter 4"))
        .await
        .unwrap();

    // A class holding a student or homework is never cascaded away.
    assert!(classes::delete(&db, fx.class_id).await.is_err());
    // Neither is a subject that homework still uses.
    assert!(subjects::delete(&db, fx.subject_id).await.is_err());
    assert!(homework::find_by_id(&db, hw.id).await.unwrap().is_some());

    // Once the homework is gone and the class is empty, the class goes.
    homework::delete(&db, hw.id).await.unwrap();
    users::create(
        &db,
        &NewUser {
            school_id: "second".into(),
            display_name: None,
            role: Role::Student,
            class_id: Some(fx.class_id),
        },
    )
    .await
    .unwrap();
    assert!(classes::delete(&db, fx.class_id).await.is_err());
    for school_id in ["second", "guranshbir126"] {
        let id = users::find_by_school_id(&db, school_id)
            .await
            .unwrap()
            .unwrap()
            .id;
        assert!(users::delete(&db, id).await.unwrap());
    }
    assert!(classes::delete(&db, fx.class_id).await.unwrap());
    assert!(subjects::delete(&db, fx.subject_id).await.unwrap());
    assert!(subjects::delete(&db, fx.other_subject_id).await.unwrap());
}

#[tokio::test]
async fn deleting_a_teacher_keeps_the_homework_they_wrote() {
    let db = pool("set-null").await;
    let fx = fixture(&db).await;
    let hw = homework::create(
        &db,
        &NewHomework {
            author_id: Some(fx.teacher_id),
            ..entry(&fx, "2026-07-23", "Chapter 4")
        },
    )
    .await
    .unwrap();
    notes::create(
        &db,
        &NewNote {
            user_id: fx.student_id,
            homework_id: Some(hw.id),
            body: "keep me".into(),
        },
    )
    .await
    .unwrap();

    assert!(users::delete(&db, fx.teacher_id).await.unwrap());

    // The entry survives with no author rather than vanishing with the account.
    let survivor = homework::find_by_id(&db, hw.id).await.unwrap().unwrap();
    assert_eq!(survivor.author_id, None);
    assert_eq!(survivor.homework_text.as_deref(), Some("Chapter 4"));
    // The student's own note is untouched.
    assert_eq!(
        notes::list_by_user(&db, fx.student_id).await.unwrap().len(),
        1
    );

    // Deleting a student does take their note and tick state with them.
    assert!(users::delete(&db, fx.student_id).await.unwrap());
    assert!(notes::list_by_user(&db, fx.student_id)
        .await
        .unwrap()
        .is_empty());
    assert!(progress::list_by_user(&db, fx.student_id)
        .await
        .unwrap()
        .is_empty());
    assert!(homework::find_by_id(&db, hw.id).await.unwrap().is_some());
}
