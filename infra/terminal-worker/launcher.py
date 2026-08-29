import json
import os
import shutil

SECRET_ENV_KEYS = (
    "AIRA_TERMINAL_RUNTIME_TOKEN",
    "AIRA_TERMINAL_GIT_AUTH_HEADER",
)


def _secret_payload() -> bytes:
    payload = {
        "runtimeToken": os.environ.get("AIRA_TERMINAL_RUNTIME_TOKEN", ""),
        "gitAuthHeader": os.environ.get("AIRA_TERMINAL_GIT_AUTH_HEADER", ""),
    }
    if not payload["runtimeToken"]:
        raise RuntimeError("AIRA_TERMINAL_RUNTIME_TOKEN is required")
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def sanitized_environment(secret_fd: int) -> dict[str, str]:
    env = dict(os.environ)
    for key in SECRET_ENV_KEYS:
        env.pop(key, None)
    env["AIRA_TERMINAL_SECRET_FD"] = str(secret_fd)
    env["AIRA_TERMINAL_REQUIRE_SECRET_FD"] = "true"
    return env


def main() -> None:
    if not hasattr(os, "memfd_create"):
        raise RuntimeError("Linux memfd support is required for terminal worker secret isolation")
    fd = os.memfd_create("aira-terminal-worker-secrets", flags=0)
    try:
        os.write(fd, _secret_payload())
        os.lseek(fd, 0, os.SEEK_SET)
        os.set_inheritable(fd, True)
        python = shutil.which("python3")
        if not python:
            raise RuntimeError("python3 is required")
        argv = [
            python,
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8080",
            "--no-access-log",
        ]
        os.execve(python, argv, sanitized_environment(fd))
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


if __name__ == "__main__":
    main()
