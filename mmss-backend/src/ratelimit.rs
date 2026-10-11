//! Abuse protection for the endpoints that take a password.
//!
//! Login, reauthentication and credential verification all accept a secret and all
//! answer "no" identically, which makes them the obvious thing to hammer. A limit on
//! them does not make a weak password strong -- nothing can, and the per-account
//! limit below is deliberately modest -- but it turns an unbounded online guessing
//! run into a slow one, and it is the difference between a handful of attempts a
//! minute from one address and thousands.
//!
//! # Fixed window, in process, honestly labelled
//!
//! This is a counter with a clock, not a rate limiter library, because a school
//! deployment is a single Axum process on one VPS with no Redis in front of it. The
//! consequences are stated rather than hidden: the count resets on the window
//! boundary (so a caller gets at most `2 * limit` attempts across a boundary), and
//! two processes behind a load balancer would each keep their own count. Both are
//! acceptable for "make online guessing tedious". Neither would be acceptable as a
//! billing quota, and this is not one.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::clock::now_ms;

/// Attempts allowed per window on `POST /auth/login`.
pub const LOGIN_ATTEMPTS: u32 = 10;

/// Attempts allowed per window on every endpoint that re-verifies a password.
pub const PASSWORD_ATTEMPTS: u32 = 10;

/// Attempts allowed per window, per source address, on sign-in.
///
/// Generous on purpose, because the shared-address case is real and this budget is
/// charged on *every* attempt, successes included: one school sits behind one NAT, so
/// a morning signing-in peak puts every student's logins on the same counter. A few
/// hundred students on two devices each is the order of magnitude this must absorb.
///
/// It exists to stop bulk guessing *across* accounts, which the per-account limit
/// cannot see — not to make a single account's limit strict. That is the per-account
/// limit, and it is not spoofable. An earlier value of 100 was low enough that a
/// realistic morning peak could exhaust it and lock the whole school out of signing
/// in, which is a self-inflicted denial of service rather than a protection.
pub const ADDRESS_ATTEMPTS: u32 = 1_000;

/// Window both limits share: five minutes.
pub const WINDOW_MS: i64 = 5 * 60 * 1000;

/// Above this many tracked subjects the table is swept.
///
/// Without it the map is a memory-growth vector -- a caller rotating `school_id` values
/// would add an entry per attempt forever. The sweep **retains every entry whose window
/// is still open** and drops only the finished ones.
///
/// An earlier version cleared the whole table instead, which made an abuse control into
/// an abuse *accelerator*: login is keyed by a caller-supplied school id, so ten
/// thousand junk ids wiped the counters of every real account, including the
/// per-account budget that guards password verification. Anybody who could reach login
/// could therefore reset a victim's limit at will and carry on guessing.
const MAX_TRACKED_SUBJECTS: usize = 10_000;

/// The outcome of asking the limiter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Verdict {
    pub allowed: bool,
    /// Seconds until the subject may try again. Zero when allowed.
    pub retry_after_seconds: i64,
}

/// `subject -> (window started at, attempts used)` for one bucket.
type Window = HashMap<String, (i64, u32)>;

/// `bucket -> that bucket's windows`.
type Buckets = HashMap<String, Window>;

/// Fixed-window counters, one table **per bucket**.
///
/// One shared table was a real bug, and the shape of this type is the fix: the `login`
/// bucket is keyed by a school id the caller chooses, so its keyspace is unbounded,
/// while `password` is keyed by a user id and is bounded by the number of real
/// accounts. In a single table a flood of junk school ids filled the shared space and
/// new entries stopped being remembered -- which silently disabled the per-account
/// limit on password verification, the one control that cannot be rotated away. One
/// table per bucket means an attacker's unbounded keyspace can only ever exhaust
/// **its own** budget.
#[derive(Debug)]
pub struct RateLimiter {
    window_ms: i64,
    /// `bucket -> (subject -> (window started at, attempts used))`.
    buckets: Mutex<Buckets>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new(WINDOW_MS)
    }
}

impl RateLimiter {
    pub fn new(window_ms: i64) -> Self {
        Self {
            window_ms,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Counts one attempt against `subject` and says whether it may proceed.
    ///
    /// `subject` is deliberately opaque to this module and supplied by the caller:
    /// a normalised school id for login, a user id for everything else. The caller
    /// decides the granularity, and no caller keys on a raw password.
    pub fn check(&self, bucket: &str, subject: &str) -> Verdict {
        let limit = match bucket {
            BUCKET_LOGIN => LOGIN_ATTEMPTS,
            // A shared address gets a larger budget than a named account, because one
            // school legitimately sits behind a single NAT and every student in it would
            // otherwise spend the same ten attempts.
            BUCKET_ADDRESS => ADDRESS_ATTEMPTS,
            BUCKET_GLOBAL => GLOBAL_ATTEMPTS,
            _ => PASSWORD_ATTEMPTS,
        };
        let now = now_ms();
        let mut buckets = self.lock();
        let entries = buckets.entry(bucket.to_owned()).or_default();

        if entries.len() > MAX_TRACKED_SUBJECTS {
            self.forget_expired(entries, now);
        }
        let (started, used) = entries.get(subject).copied().unwrap_or((now, 0));

        let (started, used) = if now.saturating_sub(started) >= self.window_ms {
            // A new window. Resetting here rather than lazily is what keeps a subject
            // that stopped trying from holding a slot forever.
            (now, 1)
        } else {
            (started, used + 1)
        };

        let allowed = used <= limit;
        let retry_after_seconds = if allowed {
            0
        } else {
            ((self.window_ms - (now - started)) as f64 / 1000.0).ceil() as i64
        };
        // Only remembered while this bucket has room. An unremembered subject loses its
        // own per-subject counter and nobody else's, and is still subject to the
        // process-wide ceiling. See `forget_expired` and the type's doc comment.
        if entries.contains_key(subject) || entries.len() < MAX_TRACKED_SUBJECTS {
            entries.insert(subject.to_owned(), (started, used));
        }

        Verdict {
            allowed,
            retry_after_seconds,
        }
    }

    /// Frees room in **one bucket** by forgetting only what has already expired.
    ///
    /// The obvious alternatives were both wrong and are recorded so they are not
    /// re-invented:
    ///
    /// * **Clearing the whole table** hands an attacker the reset button. Ten thousand
    ///   junk school ids wiped every real account's counter, including the budget
    ///   guarding password verification.
    /// * **Evicting the oldest live entry** still destroys the target: the victim's
    ///   window is older than the flood trying to erase it, so oldest-first picks
    ///   exactly the wrong entry.
    ///
    /// So nothing live is ever forgotten. A subject arriving at a full bucket simply
    /// gets no counter of its own, which costs it its per-subject limit and nobody
    /// else's -- and it is still covered by [`BUCKET_GLOBAL`], the one bucket whose key
    /// the caller does not choose.
    fn forget_expired(&self, entries: &mut Window, now: i64) {
        entries.retain(|_, (started, _)| now.saturating_sub(*started) < self.window_ms);
    }

    /// The lock is taken for the length of one `HashMap` operation and never held
    /// across an await, so it cannot become a point where one slow request stalls
    /// every other request in the process. A poisoned lock is recovered rather than
    /// propagated: the only way to poison it is a panic inside `check`, and refusing
    /// every login after that would be a worse outcome than forgetting a count.
    fn lock(&self) -> std::sync::MutexGuard<'_, Buckets> {
        self.buckets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Bucket name for sign-in attempts. Login is limited per school id rather than per
/// address, because the attack that matters here is guessing one student's password
/// and the victim is identified by the school id, not the network.
pub const BUCKET_LOGIN: &str = "login";

/// Bucket name for every other password check: reauthentication, password change,
/// credential verification.
pub const BUCKET_PASSWORD: &str = "password";

/// Bucket name for the per-address sign-in budget. See [`ADDRESS_ATTEMPTS`].
pub const BUCKET_ADDRESS: &str = "address";

/// Ceiling on sign-in attempts for the whole process in one window, regardless of
/// which school id or address they claim.
///
/// This is the bucket that makes flooding self-defeating. Per-account and per-address
/// limits both key on values the caller chooses, so neither can stop an attacker who
/// simply varies them -- and both cost the server a full argon2id verification per
/// attempt, so unbounded rotation is a denial-of-service in its own right. A single
/// shared ceiling means ten thousand junk ids burn ten thousand real attempts and the
/// attacker is then refused.
///
/// Sized for the morning peak: a school of several hundred students signing in on two
/// devices each fits comfortably, and a sustained attack against one account does not.
pub const GLOBAL_ATTEMPTS: u32 = 2_000;

/// Bucket name for the process-wide sign-in ceiling. Always used with one fixed
/// subject, so the table holds exactly one entry for it.
pub const BUCKET_GLOBAL: &str = "global";

/// How long to tell a caller to wait, as a `Duration`, for a `Retry-After` header.
pub fn retry_after(verdict: &Verdict) -> Duration {
    Duration::from_secs(verdict.retry_after_seconds.max(1) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A limiter with a window long enough that nothing expires during a test, so the
    /// assertions are about counting rather than about the clock.
    fn limiter(limit_window_ms: i64) -> RateLimiter {
        RateLimiter::new(limit_window_ms)
    }

    #[test]
    fn attempts_up_to_the_limit_pass_and_the_next_one_does_not() {
        let limiter = limiter(WINDOW_MS);
        for _ in 0..LOGIN_ATTEMPTS {
            assert!(limiter.check(BUCKET_LOGIN, "student.1").allowed);
        }
        let refused = limiter.check(BUCKET_LOGIN, "student.1");
        assert!(!refused.allowed);
        assert!(
            (1..=300).contains(&refused.retry_after_seconds),
            "a refused caller must be told how long to wait, got {}",
            refused.retry_after_seconds
        );
    }

    #[test]
    fn one_subject_exhausting_its_budget_does_not_lock_out_another() {
        let limiter = limiter(WINDOW_MS);
        for _ in 0..=LOGIN_ATTEMPTS {
            limiter.check(BUCKET_LOGIN, "victim");
        }
        assert!(!limiter.check(BUCKET_LOGIN, "victim").allowed);
        assert!(
            limiter.check(BUCKET_LOGIN, "bystander").allowed,
            "an attacker must not be able to lock a bystander out"
        );
    }

    #[test]
    fn the_two_buckets_are_counted_separately() {
        let limiter = limiter(WINDOW_MS);
        for _ in 0..=LOGIN_ATTEMPTS {
            limiter.check(BUCKET_LOGIN, "student.1");
        }
        assert!(!limiter.check(BUCKET_LOGIN, "student.1").allowed);
        assert!(
            limiter.check(BUCKET_PASSWORD, "student.1").allowed,
            "a login lockout must not silently become a password-change lockout"
        );
    }

    #[test]
    fn a_new_window_starts_the_count_over() {
        // A one-millisecond window: the sleep is the point of the test, not an
        // incidental delay.
        let limiter = limiter(1);
        assert!(limiter.check(BUCKET_LOGIN, "student.1").allowed);
        std::thread::sleep(Duration::from_millis(3));
        assert!(
            limiter.check(BUCKET_LOGIN, "student.1").allowed,
            "an expired window must not refuse the first attempt in the new one"
        );
    }

    #[test]
    fn an_unknown_bucket_falls_back_to_the_password_budget() {
        // Not a silent unlimited lane: anything unrecognised is the stricter of the
        // two, which is what an unrecognised bucket should mean.
        let limiter = limiter(WINDOW_MS);
        for _ in 0..PASSWORD_ATTEMPTS {
            assert!(limiter.check("something-new", "subject").allowed);
        }
        assert!(!limiter.check("something-new", "subject").allowed);
    }

    #[test]
    fn a_rotating_subject_cannot_grow_the_table_without_bound() {
        let limiter = limiter(WINDOW_MS);
        for index in 0..(MAX_TRACKED_SUBJECTS * 2) {
            limiter.check(BUCKET_LOGIN, &format!("student.{index}"));
        }
        let buckets = limiter.buckets.lock().unwrap();
        assert!(
            buckets.get(BUCKET_LOGIN).map_or(0, HashMap::len) <= MAX_TRACKED_SUBJECTS,
            "the table must stay bounded no matter what the caller sends"
        );
    }

    #[test]
    fn flooding_junk_subjects_cannot_reset_a_victims_budget() {
        // The regression this locks down: the sweep used to clear the whole table, and
        // login is keyed by a caller-supplied school id -- so anybody could spend ten
        // thousand junk ids to wipe a locked-out victim's counters and carry on guessing.
        let limiter = limiter(WINDOW_MS);
        for _ in 0..=LOGIN_ATTEMPTS {
            limiter.check(BUCKET_LOGIN, "victim");
        }
        assert!(!limiter.check(BUCKET_LOGIN, "victim").allowed);

        for index in 0..(MAX_TRACKED_SUBJECTS + 50) {
            limiter.check(BUCKET_LOGIN, &format!("junk.{index}"));
        }

        assert!(
            !limiter.check(BUCKET_LOGIN, "victim").allowed,
            "the victim's budget must survive a flood of unrelated subjects"
        );
        // The password bucket is keyed by a user id and lives in its own table, so a
        // login flood cannot reach it even when the login table is completely full.
        for _ in 0..=PASSWORD_ATTEMPTS {
            limiter.check(BUCKET_PASSWORD, "42");
        }
        for index in 0..(MAX_TRACKED_SUBJECTS * 2) {
            limiter.check(BUCKET_LOGIN, &format!("flood.{index}"));
        }
        assert!(
            !limiter.check(BUCKET_PASSWORD, "42").allowed,
            "the password budget must survive a login flood"
        );
    }

    #[test]
    fn a_full_table_never_evicts_a_live_entry() {
        // With a real window every entry in the flood is still live, so this is exactly
        // the situation the old "evict the oldest" attempt got wrong: the victim's
        // window is older than the flood aimed at erasing it.
        let limiter = limiter(WINDOW_MS);
        limiter.check(BUCKET_LOGIN, "victim");
        for index in 0..(MAX_TRACKED_SUBJECTS * 2) {
            limiter.check(BUCKET_LOGIN, &format!("flood.{index}"));
        }
        let buckets = limiter.buckets.lock().unwrap();
        let login = buckets.get(BUCKET_LOGIN).expect("the login bucket exists");
        assert!(
            login.contains_key("victim"),
            "a live entry must survive a flood that fills the table"
        );
        assert!(
            login.len() <= MAX_TRACKED_SUBJECTS,
            "and the table must still be bounded"
        );
    }

    #[test]
    fn the_global_ceiling_is_what_actually_stops_a_flood() {
        // The per-account and per-address buckets both key on caller-chosen values, so
        // neither survives rotation. This one does, because the attacker spends it.
        let limiter = limiter(WINDOW_MS);
        let mut allowed = 0;
        for _ in 0..(GLOBAL_ATTEMPTS + 100) {
            if limiter.check(BUCKET_GLOBAL, "all").allowed {
                allowed += 1;
            }
        }
        assert_eq!(allowed, GLOBAL_ATTEMPTS as usize);

        // Flooding with junk ids burns the shared ceiling, so the attacker locks
        // *themselves* out rather than freeing budget for a targeted attack.
        for index in 0..(GLOBAL_ATTEMPTS + 100) {
            limiter.check(BUCKET_GLOBAL, "all");
            limiter.check(BUCKET_LOGIN, &format!("junk.{index}"));
        }
        // The junk ids really were consumed from their own bucket, not the shared one.
        assert!(
            !limiter.check(BUCKET_GLOBAL, "all").allowed,
            "a flood must exhaust the shared ceiling"
        );
    }

    #[test]
    fn the_address_bucket_is_generous_but_not_unbounded() {
        let limiter = limiter(WINDOW_MS);
        for _ in 0..ADDRESS_ATTEMPTS {
            assert!(limiter.check(BUCKET_ADDRESS, "203.0.113.7").allowed);
        }
        assert!(
            !limiter.check(BUCKET_ADDRESS, "203.0.113.7").allowed,
            "one address must still stop after its budget"
        );
        // A different address is unaffected, and the login budget is a separate bucket.
        assert!(limiter.check(BUCKET_ADDRESS, "203.0.113.8").allowed);
        assert!(limiter.check(BUCKET_LOGIN, "203.0.113.7").allowed);
    }

    #[test]
    fn retry_after_is_never_zero_for_a_refusal() {
        // A `Retry-After: 0` tells a browser to come straight back, which is the one
        // value that would make the header worse than not sending it.
        assert_eq!(
            retry_after(&Verdict {
                allowed: false,
                retry_after_seconds: 0
            }),
            Duration::from_secs(1)
        );
        assert_eq!(
            retry_after(&Verdict {
                allowed: true,
                retry_after_seconds: 0
            }),
            Duration::from_secs(1)
        );
    }
}
