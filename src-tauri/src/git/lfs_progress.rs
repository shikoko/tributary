//! Progress of Git LFS transfers.
//!
//! When git runs Git LFS (to upload files before a push, or to download them during a
//! pull, clone or checkout), LFS says nothing about its progress unless it's writing to a
//! terminal. It can also log progress to a file, named by the `GIT_LFS_PROGRESS`
//! environment variable, with one line per update:
//!
//! ```text
//! upload 2/3 1441792/15000000 assets/intro.mov
//! ```
//!
//! that is, the direction, which file of how many, and that file's bytes so far of its
//! size. [`ProgressLog`] follows that file while git runs and turns it into [`Progress`].

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::{ExpectedFiles, FileCount, NamedSize, Progress};

/// How often the log file is read.
const POLL: Duration = Duration::from_millis(100);
/// How often a new report is sent when only the byte counts have changed.
const REPORT: Duration = Duration::from_millis(250);
/// The span the transfer rate is averaged over.
const RATE_WINDOW: Duration = Duration::from_secs(2);
/// The longer span the time left is worked out over, so it doesn't jump about.
const ETA_WINDOW: Duration = Duration::from_secs(15);
/// How long a transfer runs before there's a time left to give.
const ETA_AFTER: Duration = Duration::from_secs(3);

/// Follows the progress file Git LFS writes, reading what's been added since last time.
pub struct ProgressLog {
    path: PathBuf,
    read: u64,
    partial: String,
    last_poll: Option<Instant>,
    state: State,
}

impl ProgressLog {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            read: 0,
            partial: String::new(),
            last_poll: None,
            state: State::default(),
        }
    }

    /// Have the next poll read the log at once and report where it is, even if that was
    /// reported moments ago (once git has exited, there's no other chance).
    pub fn force_next(&mut self) {
        self.last_poll = None;
        self.state.reported = None;
    }

    /// The files LFS has logged so far.
    pub fn seen(&self) -> std::collections::HashSet<String> {
        self.state.files.keys().cloned().collect()
    }

    /// The files LFS will download, with their sizes (when it gets them one at a time, how
    /// many in all; and the time left, and the biggest still to come).
    pub fn expect(&mut self, files: ExpectedFiles) {
        self.state.expected = Some(files.into_iter().collect());
    }

    /// True once Git LFS has logged anything.
    pub fn active(&self) -> bool {
        self.state.direction.is_some()
    }

    /// New progress to show, if there is any.
    pub fn poll(&mut self) -> Option<Progress> {
        let now = Instant::now();
        if self.last_poll.is_some_and(|last| now - last < POLL) {
            return None;
        }
        self.last_poll = Some(now);
        let mut file = File::open(&self.path).ok()?;
        let length = file.metadata().ok()?.len();
        if length > self.read {
            file.seek(SeekFrom::Start(self.read)).ok()?;
            let mut added = Vec::new();
            file.take(length - self.read).read_to_end(&mut added).ok()?;
            self.read += added.len() as u64;
            self.partial.push_str(&String::from_utf8_lossy(&added));
            // Only whole lines: the last one may still be being written.
            if let Some(end) = self.partial.rfind('\n') {
                let complete: String = self.partial.drain(..=end).collect();
                for line in complete.lines() {
                    self.state.update(line, now);
                }
            }
        }
        self.state.report(now)
    }
}

/// What the log has said so far, for the current direction.
#[derive(Default)]
struct State {
    direction: Option<String>,
    /// Each file's bytes so far and size, by name.
    files: HashMap<String, (u64, u64)>,
    /// How many files LFS says this transfer has.
    total_files: u32,
    /// The files it will download, with their sizes, when that's known: worked out from the
    /// commits being checked out (when LFS gets them one at a time, each says it's 1 of 1).
    expected: Option<HashMap<String, u64>>,
    /// When the first line came.
    started: Option<Instant>,
    /// Bytes so far over a longer span, for the time left.
    long_samples: VecDeque<(Instant, u64)>,
    /// The file the last line was about.
    current: String,
    /// Bytes so far, all files together, over time (for the rate).
    samples: VecDeque<(Instant, u64)>,
    done: u64,
    /// The highest percentage reported, so the bar never goes backwards.
    best: u8,
    reported: Option<(Instant, Progress)>,
}

impl State {
    fn update(&mut self, line: &str, now: Instant) {
        let mut parts = line.splitn(4, ' ');
        let (Some(direction), Some(files), Some(bytes), Some(name)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return;
        };
        let pair = |text: &str| -> Option<(u64, u64)> {
            let (a, b) = text.split_once('/')?;
            Some((a.parse().ok()?, b.parse().ok()?))
        };
        let (Some((_, total_files)), Some((so_far, size))) = (pair(files), pair(bytes)) else {
            return;
        };
        if self.direction.as_deref() != Some(direction) {
            // A new transfer (a pull downloads, then checks out): start again.
            *self = State {
                direction: Some(direction.to_owned()),
                expected: self.expected.take(),
                ..State::default()
            };
        }
        self.total_files = self.total_files.max(total_files as u32);
        let entry = self.files.entry(name.to_owned()).or_insert((0, size));
        if so_far > entry.0 {
            self.done += so_far - entry.0;
            entry.0 = so_far;
        }
        entry.1 = size;
        self.current = name.to_owned();
        self.started.get_or_insert(now);
        for (samples, window) in [
            (&mut self.samples, RATE_WINDOW),
            (&mut self.long_samples, ETA_WINDOW),
        ] {
            samples.push_back((now, self.done));
            while samples.front().is_some_and(|(at, _)| now - *at > window) {
                samples.pop_front();
            }
        }
    }

    /// About how many seconds are left: the bytes to go at the rate over the last while.
    fn remaining(&self, total: u64, now: Instant) -> Option<u64> {
        if now - self.started? < ETA_AFTER || total <= self.done {
            return None;
        }
        let (first, last) = (self.long_samples.front()?, self.long_samples.back()?);
        let span = (last.0 - first.0).as_secs_f64();
        let rate = (last.1 - first.1) as f64 / span;
        (span >= 1.0 && rate > 0.0).then(|| ((total - self.done) as f64 / rate).ceil() as u64)
    }

    /// The biggest expected file that isn't done yet.
    fn biggest_left(&self) -> Option<NamedSize> {
        self.expected
            .as_ref()?
            .iter()
            .filter(|(name, size)| self.files.get(*name).is_none_or(|(done, _)| done < *size))
            .max_by_key(|(_, size)| **size)
            .map(|(name, size)| NamedSize {
                name: name.clone(),
                size: *size,
            })
    }

    /// Bytes per second, once there's enough to go on.
    fn rate(&self) -> Option<u64> {
        let (first, last) = (self.samples.front()?, self.samples.back()?);
        let span = (last.0 - first.0).as_secs_f64();
        (span >= 0.4).then(|| ((last.1 - first.1) as f64 / span) as u64)
    }

    fn report(&mut self, now: Instant) -> Option<Progress> {
        let direction = self.direction.as_deref()?;
        let phase = match direction {
            "upload" => "Uploading LFS files",
            "checkout" => "Checking out LFS files",
            _ => "Downloading LFS files",
        };
        let mut parts = Vec::new();
        let finished = self
            .files
            .values()
            .filter(|(done, size)| done >= size)
            .count() as u32;
        let mut files = None;
        // All the bytes, as far as they're known.
        let mut total_bytes = None;
        let percent = if self.total_files > 1 {
            // A batch: the share of all the bytes. Sizes are only known for files that
            // have started, so the total is extrapolated from those until all have.
            let started = self.files.len() as u64;
            let known: u64 = self.files.values().map(|(_, size)| size).sum();
            let all_started = started >= u64::from(self.total_files);
            let total = if all_started || started == 0 {
                known
            } else {
                known * u64::from(self.total_files) / started
            };
            files = Some(FileCount {
                done: finished,
                total: self.total_files,
            });
            total_bytes = Some(total);
            parts.push(format!("{finished} of {} files", self.total_files));
            parts.push(if all_started {
                format!("{} of {}", format_bytes(self.done), format_bytes(known))
            } else {
                format_bytes(self.done)
            });
            share(self.done, total)
        } else {
            // One file at a time (git downloads them as it checks them out): that file, and
            // how many of them all, when that's known.
            let (done, size) = *self.files.get(&self.current)?;
            if let Some(expected) = self.expected.as_ref().filter(|expected| expected.len() > 1) {
                let total = (expected.len() as u32).max(self.files.len() as u32);
                files = Some(FileCount {
                    done: finished,
                    total,
                });
                // The expected files' sizes, and any others LFS got too.
                let others: u64 = self
                    .files
                    .iter()
                    .filter(|(name, _)| !expected.contains_key(*name))
                    .map(|(_, (_, size))| size)
                    .sum();
                total_bytes = Some(expected.values().sum::<u64>() + others);
                parts.push(format!("{finished} of {total} files"));
            }
            parts.push(self.current.clone());
            parts.push(format!("{} of {}", format_bytes(done), format_bytes(size)));
            share(done, size)
        };
        let rate = self.rate();
        if let Some(rate) = rate {
            parts.push(format!("{}/s", format_bytes(rate)));
        }
        let remaining = total_bytes.and_then(|total| self.remaining(total, now));
        if let Some(seconds) = remaining {
            parts.push(time_left(seconds));
        }
        let percent = if self.total_files > 1 {
            self.best = self.best.max(percent);
            self.best
        } else {
            percent
        };
        let progress = Progress {
            phase: phase.into(),
            percent: Some(percent),
            detail: Some(parts.join(" · ")),
            files,
            rate,
            current: (!self.current.is_empty()).then(|| self.current.clone()),
            remaining,
            biggest_left: self.biggest_left(),
        };
        // Send changes in percentage straight away, byte counts a few times a second.
        if let Some((at, last)) = &self.reported {
            let same = *last == progress;
            let only_detail = last.phase == progress.phase
                && last.percent == progress.percent
                && last.files == progress.files;
            if same || (only_detail && now - *at < REPORT) {
                return None;
            }
        }
        self.reported = Some((now, progress.clone()));
        Some(progress)
    }
}

/// "about 3 minutes left", rounded so it doesn't flicker.
pub fn time_left(seconds: u64) -> String {
    match seconds {
        0..10 => "a few seconds left".into(),
        10..55 => format!("about {} seconds left", seconds.div_ceil(5) * 5),
        55..90 => "about a minute left".into(),
        90..3570 => format!("about {} minutes left", (seconds + 30) / 60),
        _ => {
            let minutes = (seconds + 30) / 60;
            let (hours, minutes) = (minutes / 60, minutes % 60);
            if minutes == 0 {
                format!("about {hours} h left")
            } else {
                format!("about {hours} h {minutes} min left")
            }
        }
    }
}

fn share(done: u64, total: u64) -> u8 {
    if total == 0 {
        return 0;
    }
    (done.min(total) * 100 / total) as u8
}

/// 1234567 → "1.2 MB", in the decimal units Git LFS itself uses.
pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1000 {
        return format!("{bytes} B");
    }
    let units = ["KB", "MB", "GB", "TB"];
    let mut value = bytes as f64 / 1000.0;
    let mut unit = 0;
    while value >= 999.5 && unit < units.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if value < 9.95 {
        format!("{value:.1} {}", units[unit])
    } else {
        format!("{value:.0} {}", units[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(state: &mut State, start: Instant, lines: &[(u64, &str)]) {
        for (ms, line) in lines {
            state.update(line, start + Duration::from_millis(*ms));
        }
    }

    #[test]
    fn formats_sizes_like_git_lfs() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(999), "999 B");
        assert_eq!(format_bytes(1_000), "1.0 KB");
        assert_eq!(format_bytes(56_000_000), "56 MB");
        assert_eq!(format_bytes(1_234_567), "1.2 MB");
        assert_eq!(format_bytes(999_999), "1.0 MB");
        assert_eq!(format_bytes(2_500_000_000), "2.5 GB");
    }

    #[test]
    fn reports_a_batch_by_bytes_across_all_files() {
        let start = Instant::now();
        let mut state = State::default();
        feed(
            &mut state,
            start,
            &[
                (0, "upload 1/3 0/60000000 video.bin"),
                (0, "upload 2/3 0/15000000 assets/one two.bin"),
                (0, "upload 3/3 0/5000000 small.bin"),
                (1000, "upload 3/3 5000000/5000000 small.bin"),
                (1000, "upload 1/3 15000000/60000000 video.bin"),
            ],
        );
        let progress = state.report(start + Duration::from_millis(1000)).unwrap();
        assert_eq!(progress.phase, "Uploading LFS files");
        // 20 MB of 80 MB.
        assert_eq!(progress.percent, Some(25));
        assert_eq!(
            progress.detail.as_deref(),
            Some("1 of 3 files · 20 MB of 80 MB · 20 MB/s")
        );
    }

    #[test]
    fn estimates_the_total_until_every_file_has_started() {
        let start = Instant::now();
        let mut state = State::default();
        // 4 files, 2 started, 10 MB each so far known: about 40 MB in all.
        feed(
            &mut state,
            start,
            &[
                (0, "upload 1/4 5000000/10000000 a.bin"),
                (0, "upload 2/4 5000000/10000000 b.bin"),
            ],
        );
        let progress = state.report(start).unwrap();
        assert_eq!(progress.percent, Some(25));
        assert_eq!(progress.detail.as_deref(), Some("0 of 4 files · 10 MB"));
    }

    #[test]
    fn never_goes_backwards_within_a_batch() {
        let start = Instant::now();
        let mut state = State::default();
        feed(
            &mut state,
            start,
            &[(0, "upload 1/2 9000000/10000000 a.bin")],
        );
        // Half the files have started: about 20 MB in all, so 45%.
        assert_eq!(state.report(start).unwrap().percent, Some(45));
        // The second file turns out to be huge: the share drops to 9%, the bar doesn't.
        feed(&mut state, start, &[(500, "upload 2/2 0/90000000 big.bin")]);
        assert_eq!(
            state
                .report(start + Duration::from_millis(500))
                .unwrap()
                .percent,
            Some(45)
        );
    }

    #[test]
    fn reports_one_file_at_a_time_downloads_by_file() {
        let start = Instant::now();
        let mut state = State::default();
        feed(
            &mut state,
            start,
            &[
                (0, "download 1/1 3000000/3000000 b.bin"),
                (100, "download 1/1 12000000/30000000 media/a.bin"),
            ],
        );
        let progress = state.report(start + Duration::from_millis(100)).unwrap();
        assert_eq!(progress.phase, "Downloading LFS files");
        assert_eq!(progress.percent, Some(40));
        assert_eq!(
            progress.detail.as_deref(),
            Some("media/a.bin · 12 MB of 30 MB")
        );
    }

    #[test]
    fn counts_files_downloaded_one_at_a_time() {
        let start = Instant::now();
        let mut state = State {
            expected: Some(
                [
                    ("Content/A.uasset", 3500),
                    ("Content/B.uasset", 3500),
                    ("Content/C.uasset", 8000),
                    ("Content/D.uasset", 90000),
                ]
                .into_iter()
                .map(|(name, size)| (name.to_owned(), size))
                .collect(),
            ),
            ..State::default()
        };
        // git checks out each file in turn, and LFS downloads it: always "1 of 1".
        feed(
            &mut state,
            start,
            &[
                (0, "download 1/1 3500/3500 Content/A.uasset"),
                (50, "download 1/1 3500/3500 Content/B.uasset"),
                (100, "download 1/1 1000/8000 Content/C.uasset"),
            ],
        );
        let progress = state.report(start + Duration::from_millis(100)).unwrap();
        // The bar is still about the file being downloaded; the count is about all of them.
        assert_eq!(progress.percent, Some(12));
        assert_eq!(progress.files, Some(FileCount { done: 2, total: 4 }));
        assert_eq!(
            progress.detail.as_deref(),
            Some("2 of 4 files · Content/C.uasset · 1.0 KB of 8.0 KB")
        );
        assert_eq!(progress.current.as_deref(), Some("Content/C.uasset"));
        assert_eq!(
            progress.biggest_left,
            Some(NamedSize {
                name: "Content/D.uasset".into(),
                size: 90000
            })
        );
    }

    #[test]
    fn says_about_how_long_is_left() {
        let start = Instant::now();
        let mut state = State::default();
        // 1 MB a second, for 4 seconds, of 20 MB in two files.
        let lines: Vec<String> = (0..=4)
            .map(|second| format!("download 1/2 {}/10000000 big.bin", second * 1_000_000))
            .collect();
        let mut fed: Vec<(u64, &str)> = lines
            .iter()
            .enumerate()
            .map(|(second, line)| (second as u64 * 1000, line.as_str()))
            .collect();
        fed.push((4000, "download 2/2 0/10000000 other.bin"));
        feed(&mut state, start, &fed);
        let progress = state.report(start + Duration::from_secs(4)).unwrap();
        // 16 MB to go at 1 MB a second.
        assert_eq!(progress.remaining, Some(16));
        assert!(progress.detail.unwrap().ends_with("about 20 seconds left"));
        assert_eq!(time_left(4), "a few seconds left");
        assert_eq!(time_left(170), "about 3 minutes left");
        assert_eq!(time_left(3 * 3600 + 20 * 60), "about 3 h 20 min left");
    }

    #[test]
    fn starts_again_when_the_direction_changes() {
        let start = Instant::now();
        let mut state = State::default();
        feed(
            &mut state,
            start,
            &[
                (0, "download 1/2 10/10 a.bin"),
                (0, "download 2/2 10/10 b.bin"),
                (10, "checkout 1/1 5/10 a.bin"),
            ],
        );
        let progress = state.report(start).unwrap();
        assert_eq!(progress.phase, "Checking out LFS files");
        assert_eq!(progress.percent, Some(50));
    }

    #[test]
    fn sends_byte_counts_a_few_times_a_second() {
        let start = Instant::now();
        let mut state = State::default();
        feed(
            &mut state,
            start,
            &[
                (0, "upload 1/2 1000/1000000 a.bin"),
                (0, "upload 2/2 0/1000000 b.bin"),
            ],
        );
        assert!(state.report(start).is_some());
        // Same percentage, a few more bytes, too soon: nothing new to show yet.
        feed(&mut state, start, &[(50, "upload 1/2 2000/1000000 a.bin")]);
        assert!(state.report(start + Duration::from_millis(50)).is_none());
        assert!(state.report(start + Duration::from_millis(300)).is_some());
    }

    #[test]
    fn ignores_lines_it_does_not_understand() {
        let start = Instant::now();
        let mut state = State::default();
        feed(&mut state, start, &[(0, "something else entirely")]);
        assert!(state.report(start).is_none());
    }
}
