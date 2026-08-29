use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct LogicalDedupe {
    accepted: HashSet<String>,
    pending: HashSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogicalDedupeDecision {
    FirstSeen,
    DuplicateAccepted,
    DuplicatePending,
}

impl LogicalDedupe {
    pub fn check_and_reserve(&mut self, key: &str) -> LogicalDedupeDecision {
        if self.accepted.contains(key) {
            return LogicalDedupeDecision::DuplicateAccepted;
        }
        if self.pending.contains(key) {
            return LogicalDedupeDecision::DuplicatePending;
        }
        self.pending.insert(key.to_owned());
        LogicalDedupeDecision::FirstSeen
    }

    pub fn commit(&mut self, key: &str) {
        self.pending.remove(key);
        self.accepted.insert(key.to_owned());
    }

    pub fn release(&mut self, key: &str) {
        self.pending.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserves_commits_and_releases_logical_keys() {
        let mut dedupe = LogicalDedupe::default();

        assert_eq!(
            dedupe.check_and_reserve("k"),
            LogicalDedupeDecision::FirstSeen
        );
        assert_eq!(
            dedupe.check_and_reserve("k"),
            LogicalDedupeDecision::DuplicatePending
        );

        dedupe.release("k");
        assert_eq!(
            dedupe.check_and_reserve("k"),
            LogicalDedupeDecision::FirstSeen
        );

        dedupe.commit("k");
        assert_eq!(
            dedupe.check_and_reserve("k"),
            LogicalDedupeDecision::DuplicateAccepted
        );
    }
}
