//! What a signed-in student is allowed to see.
//!
//! The rule that matters: a student's world is their class. Every read here is scoped to
//! `users.class_id` *before* anything else, so a request naming another class returns
//! nothing of that class. And a missing class is not "no restriction" -- it is "no
//! access", because a teacher or admin with no class would otherwise be handed every
//! class's homework.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use crate::api::{
    homework_view, AttachmentView, AuthorView, HomeworkContext, HomeworkFeed, HomeworkView,
};
use crate::error::{ApiError, ApiResult};
use crate::repositories::{
    attachments, homework as homework_repo, notes, progress, subjects, users,
};
use crate::services::auth::Principal;

/// The class a student may read, or a refusal.
///
/// 403 rather than an empty feed: a student with no class is misconfigured, and an empty
/// list would read as "no homework today" and quietly mislead them.
fn student_class(principal: &Principal) -> ApiResult<i64> {
    principal
        .class_id
        .ok_or_else(|| ApiError::forbidden("Your account is not assigned to a class."))
}

fn not_found() -> ApiError {
    ApiError::not_found("That homework item was not found.")
}

/// A feed request, already validated by the route.
#[derive(Debug, Clone, Default)]
pub struct HomeworkQuery {
    pub subject_id: Option<i64>,
    /// Inclusive bounds on the school day.
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
}

pub struct HomeworkService<'a> {
    db: &'a SqlitePool,
}

impl<'a> HomeworkService<'a> {
    pub fn new(db: &'a SqlitePool) -> Self {
        Self { db }
    }

    /// The student's class feed, optionally narrowed by subject, day range and limit.
    ///
    /// `requested_class` is a client-supplied filter and is only ever *checked*, never
    /// obeyed: asking for a class you are not in is refused rather than quietly answered
    /// with your own class, because silently answering a different question than the one
    /// asked is how data-leak bugs stay invisible.
    pub async fn list(
        &self,
        principal: &Principal,
        requested_class: Option<i64>,
        query: &HomeworkQuery,
    ) -> ApiResult<HomeworkFeed> {
        let own_class = student_class(principal)?;
        if let Some(requested) = requested_class {
            if requested != own_class {
                return Err(ApiError::forbidden("You are not a member of that class."));
            }
        }

        let filter = homework_repo::Filter {
            class_id: Some(own_class),
            subject_id: query.subject_id,
            due_from: query.from.clone(),
            due_to: query.to.clone(),
            limit: query.limit,
            ..Default::default()
        };
        let entries = homework_repo::list(self.db, &filter).await?;
        let views = self.decorate(&entries, principal).await?;
        Ok(HomeworkFeed::new(views))
    }

    /// One entry, by id.
    ///
    /// Scoped to the student's class in the query itself, so an id belonging to another
    /// class and an id that does not exist are both 404.
    pub async fn get(&self, principal: &Principal, homework_id: i64) -> ApiResult<HomeworkView> {
        let entry = self.find_visible(principal, homework_id).await?;
        self.decorate(std::slice::from_ref(&entry), principal)
            .await?
            .into_iter()
            .next()
            .ok_or_else(not_found)
    }

    /// Attachment metadata for one entry, subject to the same class check.
    pub async fn attachments_for(
        &self,
        principal: &Principal,
        homework_id: i64,
    ) -> ApiResult<Vec<AttachmentView>> {
        self.find_visible(principal, homework_id).await?;
        Ok(attachments::list_by_homework(self.db, homework_id)
            .await?
            .iter()
            .map(AttachmentView::from)
            .collect())
    }

    /// Whether an id is homework this student may see. The note and progress routes share
    /// this, so there is exactly one definition of "exists for this student".
    pub async fn exists_for(&self, principal: &Principal, homework_id: i64) -> ApiResult<bool> {
        self.find_visible(principal, homework_id)
            .await
            .map(|_| true)
    }

    async fn find_visible(
        &self,
        principal: &Principal,
        homework_id: i64,
    ) -> ApiResult<crate::models::Homework> {
        let own_class = student_class(principal)?;
        homework_repo::find_by_id_in_class(self.db, own_class, homework_id)
            .await?
            .ok_or_else(not_found)
    }

    /// Enriches a page of entries with everything a student-facing row needs, in five
    /// bulk queries rather than three per card.
    async fn decorate(
        &self,
        entries: &[crate::models::Homework],
        principal: &Principal,
    ) -> ApiResult<Vec<HomeworkView>> {
        let mut context = HomeworkContext::default();

        let subject_ids: Vec<i64> = unique(entries.iter().map(|entry| entry.subject_id));
        for subject in subjects::find_by_ids(self.db, &subject_ids).await? {
            context.subject_names.insert(subject.id, subject.name);
        }

        let author_ids: Vec<i64> = unique(entries.iter().filter_map(|entry| entry.author_id));
        let resolved: HashMap<i64, AuthorView> = users::find_by_ids(self.db, &author_ids)
            .await?
            .iter()
            .map(|user| (user.id, AuthorView::from(user)))
            .collect();
        for id in &author_ids {
            // An author that no longer resolves stays absent, and the view renders it
            // as null rather than as a half-built object.
            context.authors.insert(*id, resolved.get(id).cloned());
        }

        let ids: Vec<i64> = unique(entries.iter().map(|entry| entry.id));

        for attachment in attachments::list_for_homework(self.db, &ids).await? {
            context
                .attachments
                .entry(attachment.homework_id)
                .or_default()
                .push(AttachmentView::from(&attachment));
        }

        let on_page: HashSet<i64> = ids.iter().copied().collect();
        for row in progress::list_for_user_and_homework(self.db, principal.user_id, &ids).await? {
            if on_page.contains(&row.homework_id) && row.completed {
                context.completed.insert(row.homework_id);
            }
        }
        for note in notes::list_by_user_and_homework(self.db, principal.user_id, &ids).await? {
            if let Some(homework_id) = note.homework_id {
                if on_page.contains(&homework_id) {
                    context.notes.insert(homework_id, note.body);
                }
            }
        }

        Ok(entries
            .iter()
            .map(|entry| homework_view(entry, &context))
            .collect())
    }
}

/// Distinct, order-preserving. A page has a handful of subjects and at most one author,
/// so this is O(n) over the page rather than a sort.
fn unique(values: impl Iterator<Item = i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    values.filter(|value| seen.insert(*value)).collect()
}
