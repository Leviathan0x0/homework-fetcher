//! Operator-run account lifecycle: deactivation and first-password setup tokens.
//!
//! Both are CLI subcommands for the same reason R11's provisioning is. A privileged
//! operation that can be triggered by a request is a request somebody can replay, and a
//! deactivation list an operator can read *before* running is safer than a `DELETE` that
//! is already in flight.
//!
//! ```text
//! mmss-backend accounts deactivate --roster leavers.csv [--reactivate] [--reason "..."]
//! mmss-backend accounts setup-tokens --roster new-students.csv
//! mmss-backend accounts revoke-tokens --roster compromised.csv
//! ```
//!
//! The input format for all three is deliberately the smallest thing that can work: a CSV
//! with an `id` column, one school ID per row. A leavers list should be readable in one
//! glance and provably incapable of changing a role, a class, or a password.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::config::Config;
use crate::repositories::setup_tokens;
use crate::services::accounts::{clean_reason, AccountsService, ActivationOutcome};
use crate::state::AppState;

/// One row the operator has to look at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LifecycleIssue {
    pub line: usize,
    pub subject: String,
    pub reason: String,
}

/// What a bulk run did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct DeactivationReport {
    /// Accounts switched to inactive (or back, with `--reactivate`).
    pub changed: usize,
    /// Already in the requested state. Not an error: a deactivation list is expected to
    /// overlap with reality from time to time.
    pub unchanged: usize,
    pub sessions_revoked: u64,
    pub setup_tokens_revoked: u64,
    /// Issued setup tokens, **as school IDs only**. The tokens themselves are printed to
    /// stdout and never appear here, so this report is safe to paste into a ticket or
    /// keep in a log.
    pub tokens_issued: Vec<String>,
    /// Tokens that were revoked rather than issued.
    pub tokens_revoked_count: usize,
    pub issues: Vec<LifecycleIssue>,
}

impl DeactivationReport {
    pub fn is_clean(&self) -> bool {
        self.issues.is_empty()
    }
}

/// Reads a CSV of school IDs.
///
/// The one column, and nothing else, is the safety property: a file that *can* express a
/// role or a class is a file that can be aimed at the wrong account by accident. Header
/// required, because "is this the ID column or the name column" should never be a guess.
fn read_school_ids(text: &str) -> Result<Vec<(usize, String)>> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers = reader.headers().context("the file is empty")?.clone();
    let column = headers
        .iter()
        .position(|name| name.trim().eq_ignore_ascii_case("id"))
        .context("the header must have an `id` column, one school ID per row")?;

    let mut ids = Vec::new();
    let mut rejected = Vec::new();
    let mut record = csv::StringRecord::new();
    let mut lines = crate::provisioning::LineTracker::after_header(&reader);
    while reader
        .read_record(&mut record)
        .with_context(|| "could not read the file")?
    {
        let line = lines.next(&reader, text);
        let row = &record;
        // Values past the header are refused only when they carry something, for the same
        // reason R11's importer does it that way: trailing commas are normal, a stray
        // value is a mistake in the file.
        if let Some(extra) = row.iter().skip(column + 1).find(|field| !field.is_empty()) {
            rejected.push(LifecycleIssue {
                line,
                subject: extra.to_owned(),
                reason: "this file must hold school IDs only, one per row".to_owned(),
            });
            continue;
        }
        let raw = row.get(column).unwrap_or("").trim();
        let id = crate::services::auth::AuthService::normalize_school_id(raw);
        if id.is_empty() {
            rejected.push(LifecycleIssue {
                line,
                subject: "<blank>".to_owned(),
                reason: "`id` is required".to_owned(),
            });
            continue;
        }
        if id.chars().count() > 120 {
            rejected.push(LifecycleIssue {
                line,
                subject: id.chars().take(32).collect(),
                reason: "`id` must be at most 120 characters".to_owned(),
            });
            continue;
        }
        ids.push((line, id));
    }

    if !rejected.is_empty() {
        let detail = rejected
            .iter()
            .map(|issue| format!("  line {}: {}", issue.line, issue.reason))
            .collect::<Vec<_>>()
            .join("\n");
        bail!(
            "{} row(s) could not be read. Nothing was changed.\n{detail}",
            rejected.len()
        );
    }
    Ok(ids)
}

/// Deactivates -- or, with `reactivate`, re-activates -- every account in the file.
///
/// Idempotent by construction: an account already in the requested state is counted as
/// `unchanged` and no row is written, so a leavers list that gets re-run after a partial
/// failure converges rather than fighting.
pub async fn deactivate(
    pool: &SqlitePool,
    config: &Config,
    path: &Path,
    reactivate: bool,
    reason: Option<&str>,
) -> Result<DeactivationReport> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("could not read the file at {}", path.display()))?;
    let ids = read_school_ids(&text)?;

    let service = AccountsService::new(pool, config);
    let reason = clean_reason(reason);
    let mut report = DeactivationReport::default();

    for (line, school_id) in ids {
        // Case-insensitive, because a list typed by a human will not match the casing the
        // register used, and refusing to deactivate a leaver over a capital letter is the
        // wrong failure direction.
        let resolved = match crate::repositories::users::find_by_school_id(pool, &school_id).await?
        {
            Some(user) => Some(user),
            None => {
                crate::repositories::users::find_by_school_id_ignore_case(pool, &school_id).await?
            }
        };
        let Some(user) = resolved else {
            report.issues.push(LifecycleIssue {
                line,
                subject: school_id,
                reason: "no account with this school ID exists".to_owned(),
            });
            continue;
        };

        match service
            .set_active(
                user.id,
                reactivate,
                crate::repositories::account_events::CLI_ACTOR,
                reason.as_deref(),
            )
            .await
        {
            Ok(ActivationOutcome::Changed {
                sessions_revoked,
                tokens_revoked,
                ..
            }) => {
                report.changed += 1;
                report.sessions_revoked += sessions_revoked;
                report.setup_tokens_revoked += tokens_revoked;
            }
            Ok(ActivationOutcome::Unchanged { .. }) => report.unchanged += 1,
            Err(error) => report.issues.push(LifecycleIssue {
                line,
                subject: school_id,
                reason: error.to_string(),
            }),
        }
    }
    Ok(report)
}

/// Issues a first-password setup token per account in the file.
///
/// The plaintext tokens go to **stdout** and nowhere else: not into the report (which is
/// meant to be pasted into a ticket), not into a log line, and not back into the
/// database. An operator pipes them to a file, prints them on slips, and destroys the
/// file. `ACCOUNT_LIFECYCLE.md` records that the *delivery* is the school's problem and
/// that this command cannot solve it.
pub async fn issue_setup_tokens(
    pool: &SqlitePool,
    config: &Config,
    path: &Path,
) -> Result<DeactivationReport> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("could not read the file at {}", path.display()))?;
    let ids = read_school_ids(&text)?;

    let service = AccountsService::new(pool, config);
    let mut report = DeactivationReport::default();

    for (line, school_id) in ids {
        let resolved = match crate::repositories::users::find_by_school_id(pool, &school_id).await?
        {
            Some(user) => Some(user),
            None => {
                crate::repositories::users::find_by_school_id_ignore_case(pool, &school_id).await?
            }
        };
        let Some(user) = resolved else {
            report.issues.push(LifecycleIssue {
                line,
                subject: school_id,
                reason: "no account with this school ID exists".to_owned(),
            });
            continue;
        };

        match service.issue_setup_token(user.id).await {
            Ok(issued) => {
                // The one and only time this value is readable. `Debug` on
                // `IssuedSetupToken` is redacted, so it cannot escape through an error
                // path either.
                println!("{}\t{}", issued.user_id, issued.token);
                report.tokens_issued.push(school_id);
            }
            Err(error) => report.issues.push(LifecycleIssue {
                line,
                subject: school_id,
                reason: error.to_string(),
            }),
        }
    }
    Ok(report)
}

/// Revokes every unused setup token for the accounts in the file.
///
/// The recovery operation for a lost or over-shared slip, and the one to reach for when
/// a leaver's account was never deactivated.
pub async fn revoke_setup_tokens(pool: &SqlitePool, path: &Path) -> Result<DeactivationReport> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("could not read the file at {}", path.display()))?;
    let ids = read_school_ids(&text)?;
    let mut report = DeactivationReport::default();

    for (line, school_id) in ids {
        let user = match crate::repositories::users::find_by_school_id(pool, &school_id).await? {
            Some(user) => Some(user),
            None => {
                crate::repositories::users::find_by_school_id_ignore_case(pool, &school_id).await?
            }
        };
        let Some(user) = user else {
            report.issues.push(LifecycleIssue {
                line,
                subject: school_id,
                reason: "no account with this school ID exists".to_owned(),
            });
            continue;
        };
        let revoked = setup_tokens::revoke_for_user(pool, user.id).await?;
        if revoked > 0 {
            report.tokens_revoked_count += revoked as usize;
        } else {
            report.unchanged += 1;
        }
    }
    Ok(report)
}

/// `mmss-backend accounts <subcommand> ...`
pub async fn run_cli(args: &[String]) -> Result<()> {
    let (subcommand, rest) = args.split_first().context(
        "usage: mmss-backend accounts <deactivate|setup-tokens|revoke-tokens> --roster <path>",
    )?;

    let mut roster: Option<&str> = None;
    let mut reactivate = false;
    let mut reason: Option<&str> = None;
    let mut index = 0;
    while index < rest.len() {
        match rest[index].as_str() {
            "--roster" => {
                roster = Some(
                    rest.get(index + 1)
                        .context("--roster needs a path to a CSV file")?,
                );
                index += 2;
            }
            "--reactivate" => {
                reactivate = true;
                index += 1;
            }
            "--reason" => {
                reason = Some(rest.get(index + 1).context("--reason needs some text")?);
                index += 2;
            }
            other => bail!("unknown argument {other:?}; see ACCOUNT_LIFECYCLE.md"),
        }
    }
    let path = roster.context(
        "nothing to do. Usage: mmss-backend accounts <deactivate|setup-tokens|revoke-tokens> \
         --roster <path.csv>",
    )?;

    let config = Config::from_env()?;
    let state = AppState::new(config).await?;
    let db = &state.db;

    let (report, label) = match subcommand.as_str() {
        "deactivate" => (
            deactivate(db, &state.config, Path::new(path), reactivate, reason).await?,
            if reactivate {
                "reactivation"
            } else {
                "deactivation"
            },
        ),
        "setup-tokens" => (
            issue_setup_tokens(db, &state.config, Path::new(path)).await?,
            "setup token issue",
        ),
        "revoke-tokens" => (
            revoke_setup_tokens(db, Path::new(path)).await?,
            "setup token revocation",
        ),
        other => bail!(
            "unknown subcommand {other:?}; expected deactivate, setup-tokens or revoke-tokens"
        ),
    };

    println!("{}", serde_json::to_string_pretty(&report)?);
    if !report.is_clean() {
        bail!(
            "{} row(s) were not applied. The database is consistent, but the file and the \
             database do not yet agree -- see `issues` above.",
            report.issues.len()
        );
    }
    tracing::info!(
        changed = report.changed,
        unchanged = report.unchanged,
        sessions_revoked = report.sessions_revoked,
        setup_tokens_revoked = report.setup_tokens_revoked,
        tokens_issued = report.tokens_issued.len(),
        operation = label,
        "account lifecycle operation complete"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_id_per_row_and_nothing_else() {
        let ids = read_school_ids("id\n2026001\n2026002\n").unwrap();
        assert_eq!(
            ids,
            vec![(2, "2026001".to_owned()), (3, "2026002".to_owned())]
        );
    }

    #[test]
    fn trailing_commas_are_tolerated_but_a_second_value_is_not() {
        assert!(read_school_ids("id\n2026001,,\n").is_ok());
        let error = read_school_ids("id\n2026001,2026002\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("school IDs only"), "{error}");
        assert!(error.contains("line 2"), "{error}");
    }

    #[test]
    fn school_ids_are_normalised_the_way_a_login_normalises_them() {
        // A leavers list typed by a human will not match the register's casing or use
        // school emails, and refusing over that is the wrong failure direction.
        let ids = read_school_ids("id\n  2026001  \n2026002@manavmangalschool.com\n").unwrap();
        assert_eq!(
            ids,
            vec![(2, "2026001".to_owned()), (3, "2026002".to_owned())]
        );
    }

    #[test]
    fn a_header_is_required_and_must_name_the_column() {
        // "Is this the ID column or the name column" must never be a guess.
        for bad in ["school_id\n2026001\n", "name\nAarav\n", ""] {
            assert!(
                read_school_ids(bad).is_err(),
                "{bad:?} must be refused rather than guessed at"
            );
        }
        // Case is forgiven, because a header typed by hand is not a command line.
        assert!(read_school_ids("ID\n2026001\n").is_ok());
    }

    #[test]
    fn a_row_with_no_id_stops_the_run_but_a_blank_line_does_not() {
        // A spreadsheet that leaves a row's cells empty exports `,,` -- a record with
        // fields and no value. That is a mistake in the list and must not be skipped,
        // because a leaver who is silently left active is the worst outcome here.
        let error = read_school_ids("id\n2026001\n,,\n2026003\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("`id` is required"), "{error}");
        assert!(error.contains("line 3"), "{error}");
        assert!(error.contains("Nothing was changed"), "{error}");

        // A genuinely blank line, by contrast, carries no row at all. Skipping it is safe:
        // there is no ID there, so nothing can be deactivated by accident.
        let ids = read_school_ids("id\n2026001\n\n2026003\n").unwrap();
        assert_eq!(
            ids,
            vec![(2, "2026001".to_owned()), (4, "2026003".to_owned())],
            "a blank line is not a row, and the line numbers after it must still be right \
             -- a number an operator cannot use to find the row is worse than none"
        );
    }

    #[test]
    fn an_absurdly_long_id_is_refused_rather_than_truncated() {
        let error = read_school_ids(&format!("id\n{}\n", "x".repeat(200)))
            .unwrap_err()
            .to_string();
        assert!(error.contains("120 characters"), "{error}");
    }
}
