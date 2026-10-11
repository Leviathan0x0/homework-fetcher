//! Timestamps are INTEGER Unix epoch milliseconds (UTC) throughout the schema.
//!
//! One format, native `i64` in Rust, and correct numeric comparison and ordering
//! in SQL. The old system mixed ISO-8601 text on some tables with integer
//! expiry on others, which forced a parser on every read.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, UTC.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_is_plausible_epoch_millis() {
        let now = now_ms();
        // Later than 2020-01-01 and earlier than 2100-01-01.
        assert!(now > 1_577_836_800_000, "{now}");
        assert!(now < 4_102_444_800_000, "{now}");
    }
}
