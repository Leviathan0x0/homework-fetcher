//! What a teacher is allowed to do with homework.
//!
//! Every decision in this module comes from the authenticated session plus the
//! database. Nothing the request says about identity is ever consulted:
//!
//!   * `author_id` on create is the principal's own id, unconditionally. There is
//!     no field on the request body that could compete with it.
//!   * A `classId` in a body or query is the *target resource*, not a credential.
//!     It is checked against `teacher_classes`, never obeyed.
//!   * Ownership for edit and delete is `homework.author_id`. A teacher assigned to
//!     a class may *see* that class's homework -- including entries a colleague
//!     wrote, which they would otherwise see duplicated in the student app -- but
//!     may only change their own. Admins change anything.
//!
//! That last distinction is the whole reason the service layer exists here. Reading
//! is scoped by teaching duty and writing is scoped by authorship, and collapsing
//! the two into one rule would either leak another teacher's draft or hide a class's
//! real homework from a colleague standing in for them.
//!
//! Validation lives here too, before any write, so a rejected request never reaches
//! SQLite. The transaction boundary is here as well: an entry with attachments is
//! more than one row, and those rows are written together or not at all.

use sqlx::SqlitePool;

use crate::api::{
    teacher_homework_view, AuthorView, CreateHomeworkBody, HomeworkContext, TeacherHomeworkList,
    TeacherHomeworkView, UpdateHomeworkBody,
};
use crate::error::{ApiError, ApiResult};
use crate::models::{Homework, NewAttachment, NewHomework};
use crate::repositories::{
    attachments as attachments_repo, classes, homework as homework_repo, subjects, teacher_classes,
    users,
};
use crate::services::auth::Principal;
use crate::validate::{
    attachment_list, optional_text_body, require_content, CalendarDate, MAX_HOMEWORK_LEN,
};

/// Who is acting, reduced to the two things that matter here.
///
/// A student is rejected before any of this: `Role::Student` cannot reach the
/// teacher service at all, so there is no code path where a student's homework
/// rights are evaluated rather than refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Actor {
    /// Own entries only.
    Teacher,
    /// Any entry.
    Admin,
}

impl Actor {
    /// Classifies the principal. The role comes from the session, resolved through
    /// the user row, never from the request.
    fn of(principal: &Principal) -> ApiResult<Self> {
        match principal.role {
            crate::models::Role::Admin => Ok(Self::Admin),
            crate::models::Role::Teacher => Ok(Self::Teacher),
            crate::models::Role::Student => {
                Err(ApiError::forbidden("This resource is for teachers."))
            }
        }
    }

    /// Whether this actor may change or remove `entry`.
    fn may_manage(&self, principal: &Principal, entry: &Homework) -> bool {
        match self {
            Self::Admin => true,
            Self::Teacher => entry.author_id == Some(principal.user_id),
        }
    }
}

fn not_found() -> ApiError {
    ApiError::not_found("That homework item was not found.")
}

/// An id that exists but belongs to someone else.
///
/// 403 rather than 404: the caller is a teacher who can already see this entry in
/// their list, so a 404 would be a lie that costs nothing to break and helps nobody.
/// This differs from the student path deliberately -- a student cannot list another
/// class's homework at all, so there a 404 is the honest answer.
fn forbidden() -> ApiError {
    ApiError::forbidden("You can only change your own homework.")
}

/// The listing filters, already validated by the route.
#[derive(Debug, Clone, Default)]
pub struct TeacherQuery {
    pub class_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
}

pub struct TeacherHomeworkService<'a> {
    db: &'a SqlitePool,
}

impl<'a> TeacherHomeworkService<'a> {
    pub fn new(db: &'a SqlitePool) -> Self {
        Self { db }
    }

    /// Entries the caller may see.
    ///
    /// A teacher sees their assigned classes, and nothing else: no assignment means
    /// no rows, never "no restriction". An admin sees everything, because they may
    /// manage any of it. A `classId` filter narrows further, and naming a class the
    /// caller does not teach is refused instead of silently answering with their own
    /// classes -- answering a different question than the one asked is how leaks stay
    /// invisible.
    pub async fn list(
        &self,
        principal: &Principal,
        query: &TeacherQuery,
    ) -> ApiResult<TeacherHomeworkList> {
        let actor = Actor::of(principal)?;

        let class_ids = match actor {
            Actor::Admin => match query.class_id {
                // One class: the same leftmost index prefix as a class-only filter.
                Some(id) => vec![id],
                // An empty list means "no class restriction" for this actor, which is
                // why the empty-vec early return below is a teacher-only branch.
                None => Vec::new(),
            },
            Actor::Teacher => {
                let assigned =
                    teacher_classes::list_for_teacher(self.db, principal.user_id).await?;
                if let Some(requested) = query.class_id {
                    if !assigned.contains(&requested) {
                        return Err(ApiError::forbidden("You are not assigned to that class."));
                    }
                }
                // No assignment is NO access, never no restriction. Without this the
                // empty `class_ids` below would read as "every class" and hand a
                // teacher the whole school -- the exact inversion of the rule. An
                // unassigned teacher may still name a class, and that class was just
                // checked, so this is only reachable without one.
                if assigned.is_empty() {
                    return Ok(TeacherHomeworkList::new(Vec::new()));
                }
                assigned
            }
        };

        let filter = homework_repo::Filter {
            class_id: None,
            class_ids,
            subject_id: query.subject_id,
            author_id: None,
            due_from: query.from.clone(),
            due_to: query.to.clone(),
            limit: query.limit,
        };
        let entries = homework_repo::list(self.db, &filter).await?;
        let views = self.decorate(&entries).await?;
        Ok(TeacherHomeworkList::new(views))
    }

    /// One entry, by id.
    ///
    /// Scoped the same way as the list: a teacher may read an entry in a class they
    /// teach or one they wrote, so a colleague's entry for the same class is
    /// reachable and an entry from a class they do not teach is a 404.
    pub async fn get(
        &self,
        principal: &Principal,
        homework_id: i64,
    ) -> ApiResult<TeacherHomeworkView> {
        let actor = Actor::of(principal)?;
        let entry = self.find_readable(actor, principal, homework_id).await?;
        Ok(self.decorate(std::slice::from_ref(&entry)).await?.remove(0))
    }

    /// Creates one entry with its attachment metadata.
    ///
    /// The author is the authenticated user, whatever the body contains. A teacher
    /// must be assigned to the target class; an admin may target any class.
    ///
    /// One transaction whenever more than one row is written. With no attachments
    /// there is nothing to lose, so the single insert runs directly rather than
    /// opening a transaction to make one statement atomic with itself.
    pub async fn create(
        &self,
        principal: &Principal,
        body: &CreateHomeworkBody,
    ) -> ApiResult<TeacherHomeworkView> {
        let actor = Actor::of(principal)?;

        // Target checks before content checks: a caller who may not write to that
        // class learns nothing about whether their prose was acceptable.
        if classes::find_by_id(self.db, body.class_id).await?.is_none() {
            return Err(ApiError::bad_request("That class does not exist."));
        }
        if !self.may_target(actor, principal, body.class_id).await? {
            return Err(ApiError::forbidden("You are not assigned to that class."));
        }
        if subjects::find_by_id(self.db, body.subject_id)
            .await?
            .is_none()
        {
            return Err(ApiError::bad_request("That subject does not exist."));
        }

        let due_date = calendar_date(&body.due_date)?;
        // Ends trimmed, interior untouched -- see `validate::optional_text_body`.
        let homework_text =
            optional_text_body(body.homework.as_deref(), "homework", MAX_HOMEWORK_LEN)?;
        let classwork_text =
            optional_text_body(body.classwork.as_deref(), "classwork", MAX_HOMEWORK_LEN)?;
        require_content(homework_text.as_deref(), classwork_text.as_deref())?;

        let declared = attachment_list(body.attachments.clone())?;
        let new = NewHomework {
            class_id: body.class_id,
            subject_id: body.subject_id,
            // The authenticated user, always. There is no request field that could
            // make this anything else.
            author_id: Some(principal.user_id),
            due_date,
            homework_text,
            classwork_text,
        };

        let entry = if declared.is_empty() {
            homework_repo::create(self.db, &new).await?
        } else {
            let mut tx = self.db.begin().await?;
            let entry = homework_repo::create(&mut *tx, &new).await?;
            for declared in declared {
                attachments_repo::create(
                    &mut *tx,
                    &NewAttachment {
                        homework_id: entry.id,
                        filename: declared.filename,
                        mime_type: declared.mime_type,
                        size_bytes: declared.size_bytes,
                        storage_key: declared.storage_key,
                    },
                )
                .await?;
            }
            // Committed only after every attachment row exists, so a failure part
            // way through cannot leave an entry with half its files described.
            tx.commit().await?;
            entry
        };

        Ok(self.decorate(std::slice::from_ref(&entry)).await?.remove(0))
    }

    /// Applies a partial update.
    ///
    /// Omitted fields are unchanged, `null` clears, a value is validated and
    /// written. The two halves are read out of the *existing row* and only the
    /// supplied ones replaced, so clearing `classwork` cannot accidentally null out
    /// `homework` -- the failure mode a `COALESCE`-based update invites.
    ///
    /// A PATCH that would leave the entry with neither half is refused with a 400
    /// before the write, because the R2 `CHECK` would otherwise reject it as a
    /// constraint violation and a client would see a 500 for sending valid JSON.
    pub async fn update(
        &self,
        principal: &Principal,
        homework_id: i64,
        body: &UpdateHomeworkBody,
    ) -> ApiResult<TeacherHomeworkView> {
        let actor = Actor::of(principal)?;
        let existing = homework_repo::find_by_id(self.db, homework_id)
            .await?
            .ok_or_else(not_found)?;
        if !actor.may_manage(principal, &existing) {
            return Err(forbidden());
        }

        // `classId` is a target, so moving an entry re-checks the destination. An
        // admin may move anything; a teacher may only move their own entry into a
        // class they teach.
        let new_class = match body.class_id {
            None => None,
            Some(None) => return Err(ApiError::bad_request("classId cannot be null.")),
            Some(Some(id)) if id == existing.class_id => None,
            Some(Some(id)) => {
                if classes::find_by_id(self.db, id).await?.is_none() {
                    return Err(ApiError::bad_request("That class does not exist."));
                }
                if !self.may_target(actor, principal, id).await? {
                    return Err(ApiError::forbidden("You are not assigned to that class."));
                }
                Some(id)
            }
        };

        let subject_id = match body.subject_id {
            None => existing.subject_id,
            // An id column cannot be cleared; `null` here is a client bug rather
            // than an intent, so it is refused instead of ignored.
            Some(None) => return Err(ApiError::bad_request("subjectId cannot be null.")),
            Some(Some(id)) => {
                if subjects::find_by_id(self.db, id).await?.is_none() {
                    return Err(ApiError::bad_request("That subject does not exist."));
                }
                id
            }
        };

        let due_date = match &body.due_date {
            None => existing.due_date.clone(),
            Some(None) => return Err(ApiError::bad_request("dueDate cannot be null.")),
            Some(Some(raw)) => calendar_date(raw)?,
        };

        let homework_text = match &body.homework {
            None => existing.homework_text.clone(),
            Some(value) => optional_text_body(value.as_deref(), "homework", MAX_HOMEWORK_LEN)?,
        };
        let classwork_text = match &body.classwork {
            None => existing.classwork_text.clone(),
            Some(value) => optional_text_body(value.as_deref(), "classwork", MAX_HOMEWORK_LEN)?,
        };
        require_content(homework_text.as_deref(), classwork_text.as_deref())?;

        // A PATCH that both moves the entry and edits it writes two rows, so it runs
        // in a transaction: a move that landed while the edit failed would leave the
        // entry in a class its author is no longer assigned to teach.
        let updated = match new_class {
            None => {
                homework_repo::update(
                    self.db,
                    homework_id,
                    subject_id,
                    &due_date,
                    homework_text.as_deref(),
                    classwork_text.as_deref(),
                )
                .await?
            }
            Some(class_id) => {
                let mut tx = self.db.begin().await?;
                homework_repo::update(
                    &mut *tx,
                    homework_id,
                    subject_id,
                    &due_date,
                    homework_text.as_deref(),
                    classwork_text.as_deref(),
                )
                .await?;
                let moved = homework_repo::set_class(&mut *tx, homework_id, class_id).await?;
                tx.commit().await?;
                moved
            }
        }
        .ok_or_else(not_found)?;

        Ok(self
            .decorate(std::slice::from_ref(&updated))
            .await?
            .remove(0))
    }

    /// Removes one entry and everything the R2 cascades own with it.
    ///
    /// Dependent rows are not deleted by hand: `homework -> attachments, notes,
    /// progress` are `ON DELETE CASCADE`, and a second copy of that list in
    /// application code is a second thing to forget when the schema changes.
    /// File bytes are likewise untouched -- `storage_key` resolution belongs to the
    /// storage service, which is deferred, so this drops metadata only.
    pub async fn delete(&self, principal: &Principal, homework_id: i64) -> ApiResult<()> {
        let actor = Actor::of(principal)?;
        let existing = homework_repo::find_by_id(self.db, homework_id)
            .await?
            .ok_or_else(not_found)?;
        if !actor.may_manage(principal, &existing) {
            return Err(forbidden());
        }
        homework_repo::delete(self.db, homework_id).await?;
        Ok(())
    }

    /// Whether this actor may create or move homework into `class_id`.
    async fn may_target(
        &self,
        actor: Actor,
        principal: &Principal,
        class_id: i64,
    ) -> ApiResult<bool> {
        Ok(match actor {
            Actor::Admin => true,
            Actor::Teacher => {
                teacher_classes::teaches(self.db, principal.user_id, class_id).await?
            }
        })
    }

    /// Loads an entry the caller may read, or 404.
    async fn find_readable(
        &self,
        actor: Actor,
        principal: &Principal,
        homework_id: i64,
    ) -> ApiResult<Homework> {
        let entry = homework_repo::find_by_id(self.db, homework_id)
            .await?
            .ok_or_else(not_found)?;
        // An admin reads anything. An admin holds no teacher_classes rows, so this
        // check has to come before the assignment lookup rather than after it.
        if actor == Actor::Admin {
            return Ok(entry);
        }
        if entry.author_id == Some(principal.user_id) {
            return Ok(entry);
        }
        // A teacher reads an entry in a class they teach, which is what makes a
        // colleague's entry for the same class visible without making it editable.
        let assigned = teacher_classes::teaches(self.db, principal.user_id, entry.class_id).await?;
        if assigned {
            Ok(entry)
        } else {
            Err(not_found())
        }
    }

    /// Builds the views for a page of entries, in bulk queries.
    ///
    /// Three queries regardless of page size -- classes, subjects, authors, then one
    /// for attachments -- rather than a query per row. That is the difference
    /// between a management list that stays fast at a whole term's entries and one
    /// that is accidentally quadratic.
    async fn decorate(&self, entries: &[Homework]) -> ApiResult<Vec<TeacherHomeworkView>> {
        let mut context = HomeworkContext::default();

        let class_ids = unique(entries.iter().map(|entry| entry.class_id));
        for class in classes::find_by_ids(self.db, &class_ids).await? {
            context.class_names.insert(class.id, class.name);
        }

        let subject_ids = unique(entries.iter().map(|entry| entry.subject_id));
        for subject in subjects::find_by_ids(self.db, &subject_ids).await? {
            context.subject_names.insert(subject.id, subject.name);
        }

        let author_ids = unique(entries.iter().filter_map(|entry| entry.author_id));
        let resolved: std::collections::HashMap<i64, AuthorView> =
            users::find_by_ids(self.db, &author_ids)
                .await?
                .iter()
                .map(|user| (user.id, AuthorView::from(user)))
                .collect();
        for id in &author_ids {
            // An author that no longer resolves stays absent and the view renders
            // `null` rather than a half-built object.
            context.authors.insert(*id, resolved.get(id).cloned());
        }

        let homework_ids = unique(entries.iter().map(|entry| entry.id));
        for attachment in attachments_repo::list_for_homework(self.db, &homework_ids).await? {
            context
                .attachments
                .entry(attachment.homework_id)
                .or_default()
                .push(crate::api::AttachmentView::from(&attachment));
        }

        Ok(entries
            .iter()
            .map(|entry| teacher_homework_view(entry, &context))
            .collect())
    }
}

/// A strict calendar date, rejected as a 400 that names the field.
fn calendar_date(raw: &str) -> ApiResult<String> {
    CalendarDate::parse(raw)
        .map(|date| date.to_iso())
        .ok_or_else(|| ApiError::bad_request("dueDate must be a date in YYYY-MM-DD form."))
}

/// Distinct, order-preserving.
fn unique(values: impl Iterator<Item = i64>) -> Vec<i64> {
    let mut seen = std::collections::HashSet::new();
    values.filter(|value| seen.insert(*value)).collect()
}
