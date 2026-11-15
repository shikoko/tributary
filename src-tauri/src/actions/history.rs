//! Merging, rebasing, cherry-picking and reverting, including interactive rebases.

use super::backups::back_up_rewrite;
use super::stacks::{and_moved, branch_tips, moved_along, updates_refs};
use super::support::{count, is_merge, ref_id, short};
use super::validate::{commit_id, commit_ids, current_branch, revision_name};
use super::{Extra, MergeMode, RebaseStep, StepAction};
use crate::error::{Error, Result};
use crate::git::Git;

/// Merge a branch, tag or commit into the checked-out branch.
pub(super) fn merge(
    repo: &gix::Repository,
    git: &Git,
    target: String,
    mode: MergeMode,
) -> Result<String> {
    let branch = current_branch(repo)?;
    let target = revision_name(repo, &target)?;
    match mode {
        MergeMode::Default => {
            git.run(&["merge", "--no-edit", &target])?;
            Ok(format!("Merged {} into {branch}", short(&target)))
        }
        MergeMode::NoFastForward => {
            git.run(&["merge", "--no-edit", "--no-ff", &target])?;
            Ok(format!(
                "Merged {} into {branch} with a merge commit",
                short(&target)
            ))
        }
        MergeMode::Squash => {
            // The summaries of the commits being squashed, for the message.
            let range = format!("HEAD..{target}");
            let summaries = git
                .run(&["log", "--format=%s", "--reverse", &range])
                .unwrap_or_default();
            git.run(&["merge", "--squash", "--quiet", &target])?;
            let mut message = format!("Squash merge {}\n\n", short(&target));
            for summary in summaries.lines().filter(|line| !line.trim().is_empty()) {
                message.push_str(&format!("- {summary}\n"));
            }
            // git commit offers this message (git status and the commit box show it).
            let _ = std::fs::write(repo.git_dir().join("SQUASH_MSG"), message);
            Ok(format!(
                "Squashed {} into {branch}'s staged changes: review them and commit",
                short(&target)
            ))
        }
    }
}

/// Rebase the checked-out branch onto a branch, tag or commit.
pub(super) fn rebase(repo: &gix::Repository, git: &Git, onto: String) -> Result<String> {
    let branch = current_branch(repo)?;
    let onto = revision_name(repo, &onto)?;
    let before = ref_id(repo, &format!("refs/heads/{branch}"));
    // Branches built on its commits (stacked on it) move along.
    let tips = branch_tips(git);
    let mut args = vec!["rebase"];
    if updates_refs(git) {
        args.push("--update-refs");
    }
    args.push(&onto);
    let result = git.run(&args);
    back_up_rewrite(repo, git, &branch, before);
    let moved = moved_along(repo, git, &branch, &tips);
    result?;
    Ok(format!(
        "Rebased {branch} onto {}{}",
        short(&onto),
        and_moved(&moved)
    ))
}

/// Apply the changes of a commit on top of the checked-out branch.
pub(super) fn cherry_pick(repo: &gix::Repository, git: &Git, id: String) -> Result<String> {
    let id = commit_id(repo, &id)?;
    let branch = current_branch(repo).unwrap_or_else(|_| "HEAD".into());
    let mut args = vec!["cherry-pick".to_owned()];
    // A merge commit needs to know which parent its changes are relative to.
    if is_merge(repo, id) {
        args.extend(["-m".into(), "1".into()]);
    }
    args.push(id.to_string());
    git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(format!(
        "Cherry-picked {} onto {branch}",
        id.to_hex_with_len(7)
    ))
}

/// Cherry-pick commit `id` onto `branch`, dropped on its label. The checked-out branch gets
/// the usual cherry-pick. Another is left where it is, files and all: the new commit is made
/// without touching them (`git merge-tree --write-tree --merge-base`, git 2.40 and later),
/// with the picked commit's author, date and message, and `branch` moves onto it. When that
/// would conflict it stops, changing nothing, for `branch` to be checked out and the
/// conflicts resolved there. The new commit's id goes in `extra.backup`, to undo it with
/// [`super::Action::DropTip`].
pub(super) fn cherry_pick_onto(
    repo: &gix::Repository,
    git: &Git,
    id: String,
    branch: String,
    extra: &mut Extra,
) -> Result<String> {
    if current_branch(repo).ok().as_deref() == Some(branch.as_str()) {
        return cherry_pick(repo, git, id);
    }
    let id = commit_id(repo, &id)?;
    let short_id = id.to_hex_with_len(7).to_string();
    let full = format!("refs/heads/{branch}");
    let tip = ref_id(repo, &full).ok_or_else(|| format!("There's no branch called {branch}."))?;
    let (id_hex, tip_hex) = (id.to_string(), tip.to_string());
    if git
        .run(&["merge-base", "--is-ancestor", &id_hex, &tip_hex])
        .is_ok()
    {
        return Err(format!("{branch} already has {short_id}.").into());
    }
    let parent = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id_hex}^1")])
        .map_err(|_| "A repository's first commit can't be cherry-picked onto a branch.")?
        .trim()
        .to_owned();
    let base = format!("--merge-base={parent}");
    let (code, output) = git.run_status(&[
        "merge-tree",
        "--write-tree",
        "--no-messages",
        &base,
        &tip_hex,
        &id_hex,
    ])?;
    match code {
        Some(0) => {}
        Some(1) => {
            return Err(format!(
                "{short_id} conflicts with {branch}: check out {branch} to cherry-pick it there, \
                 and resolve the conflicts."
            )
            .into());
        }
        _ => {
            return Err(format!(
                "This needs git 2.40 or later: check out {branch} to cherry-pick {short_id} there."
            )
            .into());
        }
    }
    let tree = output.lines().next().unwrap_or_default().trim().to_owned();
    // Nothing to add: the branch has these changes already (picked before, say).
    if git
        .run(&["rev-parse", &format!("{tip_hex}^{{tree}}")])?
        .trim()
        == tree
    {
        return Err(format!("{branch} already has {short_id}'s changes.").into());
    }
    let who = git.run(&[
        "log",
        "-1",
        "--format=%an%x00%ae%x00%ad",
        "--date=raw",
        &id_hex,
    ])?;
    let mut who = who.trim_end_matches('\n').split('\0');
    let (name, email, date) = (
        who.next().unwrap_or_default(),
        who.next().unwrap_or_default(),
        who.next().unwrap_or_default(),
    );
    let message = git.run(&["log", "-1", "--format=%B", &id_hex])?;
    let new = git
        .run_with_env(
            &[
                "commit-tree",
                &tree,
                "-p",
                &tip_hex,
                "-m",
                message.trim_end(),
            ],
            &[
                ("GIT_AUTHOR_NAME", name),
                ("GIT_AUTHOR_EMAIL", email),
                ("GIT_AUTHOR_DATE", date),
            ],
        )?
        .trim()
        .to_owned();
    // Only if it's still where it was.
    let reason = format!("cherry-pick {short_id} onto {branch}");
    git.run(&["update-ref", "-m", &reason, &full, &new, &tip_hex])?;
    extra.backup = Some(new);
    Ok(format!("Cherry-picked {short_id} onto {branch}"))
}

/// Undo [`cherry_pick_onto`] onto a branch that isn't checked out: move `branch` back off its
/// tip `id`, onto `id`'s parent, when it's still there and still not checked out.
pub(super) fn drop_tip(
    repo: &gix::Repository,
    git: &Git,
    branch: String,
    id: String,
) -> Result<String> {
    if current_branch(repo).ok().as_deref() == Some(branch.as_str()) {
        return Err(format!("{branch} is checked out now, so it's left as it is.").into());
    }
    let id = commit_id(repo, &id)?;
    let full = format!("refs/heads/{branch}");
    if ref_id(repo, &full) != Some(id) {
        return Err(format!("{branch} has moved on since, so it's left as it is.").into());
    }
    let id_hex = id.to_string();
    let parent = git
        .run(&["rev-parse", "--verify", "--quiet", &format!("{id_hex}^1")])?
        .trim()
        .to_owned();
    git.run(&[
        "update-ref",
        "-m",
        "undo a cherry-pick",
        &full,
        &parent,
        &id_hex,
    ])?;
    Ok(format!("Took {} back off {branch}", id.to_hex_with_len(7)))
}

/// Make a new commit that undoes a commit.
pub(super) fn revert(repo: &gix::Repository, git: &Git, id: String) -> Result<String> {
    let id = commit_id(repo, &id)?;
    let mut args = vec!["revert".to_owned(), "--no-edit".to_owned()];
    if is_merge(repo, id) {
        args.extend(["-m".into(), "1".into()]);
    }
    args.push(id.to_string());
    git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(format!("Reverted {}", id.to_hex_with_len(7)))
}

/// Cherry-pick several commits, in the order given (oldest first).
pub(super) fn cherry_pick_many(
    repo: &gix::Repository,
    git: &Git,
    ids: Vec<String>,
) -> Result<String> {
    let ids = commit_ids(repo, &ids)?;
    if ids.iter().any(|&id| is_merge(repo, id)) {
        return Err("Merge commits can only be cherry-picked one at a time.".into());
    }
    let branch = current_branch(repo).unwrap_or_else(|_| "HEAD".into());
    let mut args = vec!["cherry-pick".to_owned()];
    args.extend(ids.iter().map(ToString::to_string));
    git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(format!(
        "Cherry-picked {} onto {branch}",
        count(ids.len(), "commit")
    ))
}

/// Revert several commits, in the order given (newest first).
pub(super) fn revert_many(repo: &gix::Repository, git: &Git, ids: Vec<String>) -> Result<String> {
    let ids = commit_ids(repo, &ids)?;
    if ids.iter().any(|&id| is_merge(repo, id)) {
        return Err("Merge commits can only be reverted one at a time.".into());
    }
    let mut args = vec!["revert".to_owned(), "--no-edit".to_owned()];
    args.extend(ids.iter().map(ToString::to_string));
    git.run(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(format!("Reverted {}", count(ids.len(), "commit")))
}

/// Rewrite the commits after `onto` on the checked-out branch: reorder, reword,
/// squash, fix up or drop them. `steps` lists every one of those commits, oldest first.
pub(super) fn interactive_rebase(
    repo: &gix::Repository,
    git: &Git,
    onto: String,
    steps: Vec<RebaseStep>,
) -> Result<String> {
    let branch = current_branch(repo).ok();
    let before = branch
        .as_ref()
        .and_then(|branch| ref_id(repo, &format!("refs/heads/{branch}")));
    let tips = branch_tips(git);
    let result = rewrite(repo, git, &onto, &steps);
    let Some(branch) = branch else {
        return result;
    };
    back_up_rewrite(repo, git, &branch, before);
    let moved = moved_along(repo, git, &branch, &tips);
    result.map(|message| format!("{message}{}", and_moved(&moved)))
}

/// Fold the staged changes into commit `id` of the checked-out branch. Unstaged changes
/// are put aside while the commits after it are rewritten, and put back after.
pub(super) fn fixup_into(repo: &gix::Repository, git: &Git, id: String) -> Result<String> {
    let branch = current_branch(repo)?;
    let id = commit_id(repo, &id)?;
    let target = id.to_string();
    let short_id = id.to_hex_with_len(7).to_string();
    if git
        .run(&["merge-base", "--is-ancestor", &target, "HEAD"])
        .is_err()
    {
        return Err(format!("{short_id} isn't part of {branch}'s history.").into());
    }
    if is_merge(repo, id) {
        return Err("A merge commit can't be fixed up.".into());
    }
    let range = format!("{target}..HEAD");
    if !git
        .run(&["rev-list", "--merges", &range])?
        .trim()
        .is_empty()
    {
        return Err(format!(
            "The commits after {short_id} include merges, which can't be rewritten this way."
        )
        .into());
    }
    if git.run(&["diff", "--cached", "--quiet"]).is_ok() {
        return Err("Stage the changes to fix it up with first.".into());
    }
    let parent = repo
        .find_commit(id)
        .map_err(|e| format!("Could not read {short_id}: {e}"))?
        .parent_ids()
        .next()
        .map(|parent| parent.detach().to_string());

    let before = ref_id(repo, &format!("refs/heads/{branch}"));
    let tips = branch_tips(git);
    git.run(&["commit", "--quiet", "--fixup", &target])?;
    // The rebase's to-do list already has the fixup in place (--autosquash), and the
    // branches built on these commits move along (--update-refs): nothing to edit.
    let mut args = vec!["rebase", "--interactive", "--autosquash", "--autostash"];
    if updates_refs(git) {
        args.push("--update-refs");
    }
    args.push(parent.as_deref().unwrap_or("--root"));
    let result = git.run_with_env(&args, &[("GIT_SEQUENCE_EDITOR", ":")]);
    back_up_rewrite(repo, git, &branch, before);
    let moved = moved_along(repo, git, &branch, &tips);
    result?;
    Ok(format!(
        "Fixed up {short_id} with your staged changes{}",
        and_moved(&moved)
    ))
}

/// Rewrite the commits after `onto`: git's own interactive rebase, with the to-do list
/// written for it instead of edited by hand.
fn rewrite(
    repo: &gix::Repository,
    git: &Git,
    onto: &str,
    steps: &[RebaseStep],
) -> Result<String, Error> {
    let branch = current_branch(repo)?;
    let onto = commit_id(repo, onto)?.to_string();
    if git
        .run(&["merge-base", "--is-ancestor", &onto, "HEAD"])
        .is_err()
    {
        return Err(format!("{} isn't part of {branch}'s history.", &onto[..7]).into());
    }
    let range = format!("{onto}..HEAD");
    if !git
        .run(&["rev-list", "--merges", &range])?
        .trim()
        .is_empty()
    {
        return Err(
            "Those commits include merges, which can't be rewritten this way. Use git in a terminal for this one."
                .into(),
        );
    }
    let mut expected: Vec<String> = git
        .run(&["rev-list", &range])?
        .lines()
        .map(str::to_owned)
        .collect();
    if expected.is_empty() {
        return Err("There are no commits after that one to rewrite.".into());
    }
    let mut given: Vec<String> = steps.iter().map(|step| step.id.clone()).collect();
    expected.sort();
    given.sort();
    if given != expected {
        return Err("The branch changed. Refresh and try again.".into());
    }
    match steps.iter().find(|step| step.action != StepAction::Drop) {
        None => {
            return Err(
                "Every commit would be dropped. To do that, hard reset to the commit instead."
                    .into(),
            );
        }
        Some(first) if matches!(first.action, StepAction::Squash | StepAction::Fixup) => {
            return Err(
                "The oldest commit kept can't be squashed or fixed up: there's no commit before it to combine with."
                    .into(),
            );
        }
        _ => {}
    }

    // The to-do list and new messages live in the git folder until the rebase is done
    // (it may stop for conflicts and be continued later).
    let folder = repo.git_dir().join("tributary-rebase");
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|e| format!("Could not prepare the rebase: {e}"))?;
    let executable = sh_quote(&git.executable().to_string_lossy());
    // Other branches pointing at these commits (stacked on them): moved along with them,
    // as git's own --update-refs does, by an update-ref line after each one's commit.
    let update_refs = updates_refs(git);
    let mut stacked: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if update_refs {
        for (name, id) in branch_tips(git) {
            if name != branch {
                stacked.entry(id).or_default().push(name);
            }
        }
    }
    let mut todo = String::new();
    for (index, step) in steps.iter().enumerate() {
        let id = &step.id;
        match step.action {
            StepAction::Pick => todo.push_str(&format!("pick {id}\n")),
            StepAction::Squash => todo.push_str(&format!("squash {id}\n")),
            StepAction::Fixup => todo.push_str(&format!("fixup {id}\n")),
            StepAction::Drop => todo.push_str(&format!("drop {id}\n")),
            StepAction::Reword => {
                let message = step
                    .message
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .ok_or("Write the new message for each commit you reword.")?;
                let file = folder.join(format!("message-{index}.txt"));
                std::fs::write(&file, message)
                    .map_err(|e| format!("Could not prepare the rebase: {e}"))?;
                let file = sh_quote(&file.to_string_lossy());
                todo.push_str(&format!(
                    "pick {id}\nexec {executable} commit --amend --quiet --allow-empty --cleanup=strip --file {file}\n"
                ));
            }
        }
        for name in stacked.get(id).into_iter().flatten() {
            todo.push_str(&format!("update-ref refs/heads/{name}\n"));
        }
    }
    let todo_file = folder.join("todo");
    std::fs::write(&todo_file, todo).map_err(|e| format!("Could not prepare the rebase: {e}"))?;
    // git hands its to-do file to this "editor", which replaces it with ours.
    let editor = format!("cp {}", sh_quote(&todo_file.to_string_lossy()));
    let mut args = vec!["rebase", "--interactive", "--no-autosquash"];
    if update_refs {
        args.push("--update-refs");
    }
    args.push(&onto);
    git.run_with_env(&args, &[("GIT_SEQUENCE_EDITOR", &editor)])?;
    let _ = std::fs::remove_dir_all(&folder);
    Ok(format!("Rewrote {}'s history", branch))
}

/// A string in single quotes for git's shell, with forward slashes (git's shell on
/// Windows reads `C:/…` paths too).
pub(super) fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\\', "/").replace('\'', "'\\''"))
}
