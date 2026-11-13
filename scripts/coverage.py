import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COVERAGE = ROOT / "coverage"


def run(command: list[str], cwd: Path) -> None:
    print("$ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def project_python() -> str:
    candidates = [
        ROOT / "venv" / "Scripts" / "python.exe",
        ROOT / "venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def python_path(path: Path, interpreter: str) -> str:
    if sys.platform != "win32" and interpreter.lower().endswith(".exe"):
        result = subprocess.run(
            ["wslpath", "-w", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    return str(path)


def main() -> None:
    go_dir = COVERAGE / "go"
    python_dir = COVERAGE / "python"
    go_dir.mkdir(parents=True, exist_ok=True)
    python_dir.mkdir(parents=True, exist_ok=True)

    go_profile = go_dir / "coverage.out"
    run(
        ["go", "test", "-coverpkg=./...", f"-coverprofile={go_profile}", "./..."],
        ROOT / "backend",
    )
    summary = subprocess.run(
        ["go", "tool", "cover", f"-func={go_profile}"],
        cwd=ROOT / "backend",
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    print(summary, end="", flush=True)
    (go_dir / "summary.txt").write_text(summary, encoding="utf-8")

    python = project_python()
    run(
        [
            python,
            "-m",
            "pytest",
            "tests/agent",
            "tests/contract",
            "tests/rag",
            "tests/unit",
            "--cov=api",
            "--cov=app",
            "--cov=config",
            "--cov=core",
            "--cov=integrations",
            "--cov=schemas",
            "--cov=main",
            "--cov-report=term",
            "--cov-fail-under=80",
            f"--cov-report=xml:{python_path(python_dir / 'coverage.xml', python)}",
            f"--cov-report=html:{python_path(python_dir / 'html', python)}",
        ],
        ROOT / "ai-service",
    )

    run(["npm", "run", "test:coverage"], ROOT / "frontend")


if __name__ == "__main__":
    main()
