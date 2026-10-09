"""Verify a frozen multi-chapter plan; keep full input and outputs in an ignored directory."""
import argparse
from pathlib import Path
from evaluation.book_run import run_verification


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--failure-reports", action="store_true", help="Use the new CLI structured failure report; omit for old binaries")
    parser.add_argument("--identity-label", action="append", default=[])
    args = parser.parse_args()
    report = run_verification(args.binary, args.plan, args.output, args.identity_label, failure_reports=args.failure_reports)
    identity = report.get("identity_observation") or {}
    identity_ok = not args.identity_label or report.get("planned_chapters", 2) == 1 or identity.get("observed_reuse_in_every_later_chapter")
    if not (identity_ok and report["complete"] and report.get("application_validation")
            and report.get("repeat_resume_success") and report.get("repeat_receipts_unchanged")):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
