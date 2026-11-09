// Saying what's wrong with a new file's name, for the warnings before committing.
import type { NameProblem } from "../api";

/** Why `problem.path` will cause trouble, in a few words, like "named like a Windows device (CON)". */
export function describeNameProblem(problem: NameProblem): string {
  // The file's own name, or one of its folders'.
  const own = problem.path.slice(problem.path.lastIndexOf("/") + 1) === problem.detail;
  const which = own ? "its name" : `its folder “${problem.detail}”`;
  switch (problem.problem) {
    case "caseClash":
      return `the same as ${problem.detail} but for capitals: on Windows and macOS they're one`;
    case "reserved":
      return `${own ? "a name" : `${which} is a name`} Windows keeps for devices`;
    case "character":
      return `Windows doesn't allow ${problem.detail === "\\" ? "a backslash" : `“${problem.detail}”`} in names`;
    case "trailingDot":
      return `${which} ends in ${problem.detail.endsWith(".") ? "a dot" : "a space"}, which Windows drops`;
    case "tooLong":
      return `${problem.detail} characters long: inside a folder like C:\\Users\\you\\Projects, over Windows' 260`;
  }
}
