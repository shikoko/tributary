"""Checks the shell scripts in the workflows for syntax errors, as bash reads them.

    python3 .github/scripts/check-workflows.py [<workflow file> ...]

With no files, it checks every workflow in .github/workflows. A step's `run:` script is only
read by bash when the step runs, so a mistake in one that runs only on a release (or a beta)
would otherwise only be found then. Steps in another shell (pwsh, say) are left alone.
"""
import glob
import os
import subprocess
import sys
import tempfile

import yaml

files = sys.argv[1:] or sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "workflows", "*.yml")))
errors = 0
for path in files:
    with open(path) as f:
        workflow = yaml.safe_load(f)
    default = (workflow.get("defaults") or {}).get("run", {}).get("shell", "bash")
    for job_name, job in (workflow.get("jobs") or {}).items():
        shell = (job.get("defaults") or {}).get("run", {}).get("shell", default)
        for step in job.get("steps") or []:
            script = step.get("run")
            if not script or (step.get("shell") or shell) != "bash":
                continue
            with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as out:
                out.write(script)
            result = subprocess.run(["bash", "-n", out.name], capture_output=True, text=True)
            os.unlink(out.name)
            if result.returncode:
                errors += 1
                where = f"{os.path.basename(path)}, job {job_name}, step {step.get('name') or step.get('run').splitlines()[0]}"
                message = result.stderr.replace(out.name, "the script").strip()
                print(f"::error file={path}::{where}: {message}")
print(f"{errors} script{'s' if errors != 1 else ''} with errors" if errors else "Every workflow script reads as bash.")
sys.exit(1 if errors else 0)
