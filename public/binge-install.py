#!/usr/bin/env python3
"""Install or update binge-server on the machine running Stash.

Run as a Stash plugin task, because a browser cannot install software: the
binge Settings button calls runPluginTask, Stash executes this here, on the
host, and the UI watches /healthz until the daemon answers.

Two install methods, tried in order:

  docker  - preferred. The published image carries gallery-dl, yt-dlp and
            ffmpeg, so the X / PornHub / Save pillars work immediately, and
            --restart unless-stopped survives a reboot.
  binary  - fallback for hosts without Docker. Pulls the release build for
            this platform. Reddit works; the other three pillars need those
            three tools on PATH, and the process does NOT survive a reboot
            on its own (see the note printed at the end).

Standard library only, on purpose: this runs wherever Stash runs, and
asking a user to pip install something before they can install anything
would defeat the point.
"""

import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPO = "ordureconnoisseur/binge-server"
IMAGE = "ghcr.io/%s:latest" % REPO
CONTAINER = "binge-server"
PORT = 7878
HEALTH_URL = "http://127.0.0.1:%d/healthz" % PORT
# Loopback by default because the daemon holds a Stash API key. But that's
# only correct when the browser is ON the Stash host: if you run Stash on a
# NAS and browse from a laptop, a loopback-bound daemon installs perfectly
# and is unreachable from the only place that needs it. The UI knows which
# case it's in (is the page served from localhost?) and passes `bind`.
PUBLISH_LOOPBACK = "127.0.0.1:%d:%d" % (PORT, PORT)
PUBLISH_LAN = "%d:%d" % (PORT, PORT)


def log(msg):
    """Progress line. Stash captures plugin stderr into its log, and the
    task UI shows it live, so this is the user-visible progress."""
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()


def run(cmd, timeout=180):
    """Returns (ok, combined_output). Never raises for a missing binary."""
    try:
        p = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
        return p.returncode == 0, p.stdout.decode("utf-8", "replace").strip()
    except FileNotFoundError:
        return False, "%s not found" % cmd[0]
    except subprocess.TimeoutExpired:
        return False, "%s timed out" % " ".join(cmd[:2])
    except Exception as exc:  # noqa: BLE001 - report, never crash the task
        return False, "%s failed: %s" % (cmd[0], exc)


def health(timeout=3):
    """True when a binge-server answers locally."""
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as r:
            if r.status != 200:
                return False
            json.loads(r.read().decode("utf-8"))
            return True
    except Exception:  # noqa: BLE001 - absence is the normal case here
        return False


def reachable_off_host(timeout=3):
    """True when the running daemon answers on a non-loopback address.

    health() runs on the Stash host and so cannot tell a daemon bound to
    127.0.0.1 from one bound to every interface. That distinction is the
    whole point of the bind argument: a loopback-bound daemon installs
    perfectly, passes its own health check, and is unreachable from the
    laptop that needs it.
    """
    try:
        host = socket.gethostbyname(socket.gethostname())
    except Exception:  # noqa: BLE001
        return False
    if not host or host.startswith("127."):
        # Nothing else to try from here; assume it is fine rather than
        # reinstalling on a machine we cannot probe.
        return True
    try:
        with urllib.request.urlopen(
                "http://%s:%d/healthz" % (host, PORT), timeout=timeout) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def wait_for_health(seconds=90):
    """Poll until the daemon answers. A first Docker run has to pull ~400MB,
    so this waits well past what a warm start needs."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if health():
            return True
        time.sleep(2)
    return False


def data_dir():
    """Persistent home for the SQLite DB, beside Stash's config rather than
    inside the plugin directory - a plugin update would wipe the latter,
    taking the Reddit cookie and post history with it."""
    plugin_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(plugin_dir, "..", ".."))
    path = os.path.join(root, "binge-server-data")
    os.makedirs(path, exist_ok=True)
    return path


def in_container():
    """True when Stash itself is containerised.

    This matters more than it looks. A Stash container has python (so the
    task runs) but no docker CLI and no docker socket, so the Docker path
    below fails and we would fall through to installing the binary INSIDE
    the Stash container. That "succeeds" — the health check here passes,
    because it runs in the same container — while being useless: the port
    isn't published, so the user's browser can never reach it, and the
    process dies with the next container restart. Better to stop and say
    what actually works."""
    if os.path.exists("/.dockerenv"):
        return True
    try:
        with open("/proc/1/cgroup", "r") as f:
            blob = f.read()
        return any(k in blob for k in ("docker", "containerd", "kubepods"))
    except Exception:  # noqa: BLE001 - not Linux, or no procfs
        return False


# ── docker ───────────────────────────────────────────────────────────


def docker_available():
    ok, _ = run(["docker", "version", "--format", "{{.Server.Version}}"], 30)
    return ok


def container_exists():
    ok, out = run(
        ["docker", "ps", "-a", "--filter", "name=^/%s$" % CONTAINER,
         "--format", "{{.Names}}"], 30
    )
    return ok and CONTAINER in out.splitlines()


def install_docker(publish):
    log("Docker found. Pulling %s ..." % IMAGE)
    ok, out = run(["docker", "pull", IMAGE], 900)
    if not ok:
        log("Pull failed: %s" % out)
        return False

    if container_exists():
        # Recreate rather than start: an existing container is pinned to the
        # old image, so "update" would silently keep running the old build.
        log("Existing container found - recreating it on the new image.")
        run(["docker", "rm", "-f", CONTAINER], 60)

    log("Starting the container ...")
    ok, out = run([
        "docker", "run", "-d",
        "--name", CONTAINER,
        "--restart", "unless-stopped",
        "-p", publish,
        "-v", "%s:/data" % data_dir(),
        IMAGE,
    ], 120)
    if not ok:
        log("Start failed: %s" % out)
        return False
    return True


# ── binary ───────────────────────────────────────────────────────────


def asset_name():
    """Release asset for this platform, or None if we don't ship one."""
    sysname = platform.system().lower()
    machine = platform.machine().lower()
    arch = (
        "arm64" if machine in ("arm64", "aarch64")
        else "amd64" if machine in ("x86_64", "amd64")
        else None
    )
    if arch is None:
        return None
    if sysname == "darwin":
        return "darwin_%s" % arch, "tar.gz"
    if sysname == "linux":
        return "linux_%s" % arch, "tar.gz"
    if sysname == "windows" and arch == "amd64":
        return "windows_amd64", "zip"
    return None


def latest_release():
    req = urllib.request.Request(
        "https://api.github.com/repos/%s/releases/latest" % REPO,
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "binge-installer"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _expected_sha256(rel, filename):
    """The published SHA256 for filename, or None if unavailable.

    None means "no list to check against" (an older release, or the
    upload failed), which is not treated as a failure: the installer
    still works exactly as it did before this check existed.
    """
    url = None
    for a in rel.get("assets", []):
        if a.get("name") == "SHA256SUMS":
            url = a.get("browser_download_url")
            break
    if not url:
        return None
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "binge-installer"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read(1 << 20).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        log("Couldn't fetch SHA256SUMS (%s); continuing without it." % exc)
        return None
    for line in body.splitlines():
        parts = line.split()
        # "<hex>  <name>", and sha256sum prefixes binary mode with '*'.
        if len(parts) == 2 and parts[1].lstrip("*") == filename:
            return parts[0].lower()
    return None


def _file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _within(base, target):
    """True if target resolves inside base. Blocks ../ escape members."""
    base = os.path.realpath(base)
    full = os.path.realpath(os.path.join(base, target))
    return full == base or full.startswith(base + os.sep)


def _safe_extract_zip(z, dest):
    for name in z.namelist():
        if not _within(dest, name):
            raise ValueError("unsafe path in archive: %s" % name)
    z.extractall(dest)


def _safe_extract_tar(t, dest):
    for m in t.getmembers():
        if not _within(dest, m.name):
            raise ValueError("unsafe path in archive: %s" % m.name)
        if m.issym() or m.islnk():
            raise ValueError("link member in archive: %s" % m.name)
    t.extractall(dest)


def install_binary(publish=PUBLISH_LOOPBACK):
    target = asset_name()
    if target is None:
        log("No binge-server build is published for %s/%s."
            % (platform.system(), platform.machine()))
        return False
    suffix, _ext = target

    log("Installing the release binary.")
    try:
        rel = latest_release()
    except Exception as exc:  # noqa: BLE001
        log("Couldn't reach the GitHub releases API: %s" % exc)
        return False

    url = None
    for a in rel.get("assets", []):
        if suffix in a.get("name", ""):
            url = a.get("browser_download_url")
            break
    if not url:
        log("Release %s has no asset for %s." % (rel.get("tag_name"), suffix))
        return False

    dest = os.path.join(data_dir(), "bin")
    os.makedirs(dest, exist_ok=True)
    log("Downloading %s ..." % os.path.basename(url))

    with tempfile.TemporaryDirectory() as tmp:
        archive = os.path.join(tmp, os.path.basename(url))
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "binge-installer"})
            with urllib.request.urlopen(req, timeout=300) as r, \
                    open(archive, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as exc:  # noqa: BLE001
            log("Download failed: %s" % exc)
            return False

        # Verify against the published list when there is one. A mismatch
        # is fatal: the bytes are not what the release says they are, and
        # running them would be worse than not installing.
        want = _expected_sha256(rel, os.path.basename(url))
        if want:
            got = _file_sha256(archive)
            if got != want:
                log("Checksum mismatch for %s." % os.path.basename(url))
                log("  expected %s" % want)
                log("  got      %s" % got)
                log("Refusing to run it. Try again; if it persists, the "
                    "download is being tampered with or the release is "
                    "broken.")
                return False
            log("Checksum verified.")
        else:
            log("No SHA256SUMS published for this release; skipping the "
                "checksum check.")

        try:
            if archive.endswith(".zip"):
                with zipfile.ZipFile(archive) as z:
                    _safe_extract_zip(z, tmp)
            else:
                with tarfile.open(archive) as t:
                    # filter="data" (Python 3.12+) refuses members that
                    # escape the destination or carry unsafe metadata. A
                    # release asset should never contain such a member, so
                    # this only matters if the download were tampered with,
                    # but the extract runs on the Stash host so the belt is
                    # cheap. Fall back to a manual guard on older Pythons.
                    try:
                        t.extractall(tmp, filter="data")
                    except TypeError:
                        _safe_extract_tar(t, tmp)
        except Exception as exc:  # noqa: BLE001
            log("Couldn't unpack the download: %s" % exc)
            return False

        exe = None
        for root, _dirs, files in os.walk(tmp):
            for name in files:
                if name in ("binge-server", "binge-server.exe"):
                    exe = os.path.join(root, name)
                    break
            if exe:
                break
        if exe is None:
            log("The archive didn't contain a binge-server binary.")
            return False

        final = os.path.join(dest, os.path.basename(exe))
        shutil.copy2(exe, final)
        os.chmod(final, 0o755)

    log("Starting %s ..." % final)
    env = dict(os.environ)
    env["BINGE_DB_PATH"] = os.path.join(data_dir(), "binge-server.db")
    # Bind where the caller asked, exactly as the Docker path publishes
    # where the caller asked. Without this the binary always took the
    # daemon's own 127.0.0.1 default, so a Docker-less Stash host with
    # the user browsing from a laptop got an install that reported
    # success - the health check runs on the Stash host, so it passed -
    # wrote its address into Stash's plugin config for every browser,
    # and could not be reached from any of them. The hazard is spelled
    # out at the top of this file; only the Docker half acted on it.
    # Left alone when the operator has set one themselves: they know
    # something about their network that this script does not.
    if not env.get("BINGE_LISTEN_ADDR"):
        env["BINGE_LISTEN_ADDR"] = (
            "0.0.0.0:%d" % PORT if publish == PUBLISH_LAN
            else "127.0.0.1:%d" % PORT)
    try:
        kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                  "env": env, "cwd": data_dir()}
        if os.name == "nt":
            # Detach so the daemon isn't killed when this task's process
            # tree goes away.
            kwargs["creationflags"] = 0x00000008 | 0x00000200
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([final], **kwargs)
    except Exception as exc:  # noqa: BLE001
        log("Couldn't start it: %s" % exc)
        return False
    return True


# ── entry ────────────────────────────────────────────────────────────


def installed_url(want_lan):
    """The address to report back, which for a LAN bind is not localhost."""
    if want_lan:
        try:
            return "http://%s:%d" % (socket.gethostname(), PORT)
        except Exception:  # noqa: BLE001
            pass
    return "http://localhost:%d" % PORT


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:  # noqa: BLE001
        payload = {}
    args = (payload.get("args") or {})
    mode = args.get("mode", "install")

    if mode == "status":
        print(json.dumps({"running": health()}))
        return 0

    # "lan" when the user is browsing from another machine, so the daemon
    # has to be reachable off the Stash host to be any use to them.
    want_lan = args.get("bind") == "lan"
    publish = PUBLISH_LAN if want_lan else PUBLISH_LOOPBACK

    if health():
        # Already running is only good news if it is running somewhere
        # the browser can get to. Anyone installed by an earlier build
        # got a loopback-bound daemon whatever their situation, and
        # short-circuiting here told them everything was fine while the
        # settings card said Unreachable: the exact people this needed
        # to reach were the ones it turned away.
        if not want_lan or reachable_off_host():
            log("binge-server is already running on port %d - nothing to do."
                % PORT)
            print(json.dumps({"ok": True, "url": installed_url(want_lan),
                              "method": "already-running"}))
            return 0
        log("binge-server is running but only on this machine's loopback, "
            "and your browser is somewhere else. Reinstalling it so it "
            "listens on the network.")

    method = None
    if docker_available():
        method = "docker" if install_docker(publish) else None
        if method is None and in_container():
            # Falling through to the binary here would put the daemon
            # inside the Stash container, on a port nothing outside can
            # reach, gone on the next restart. That is what in_container
            # exists to prevent, and it was only consulted when Docker
            # was absent entirely rather than when Docker was present
            # and failed.
            log("")
            log("Docker is available but the image could not be pulled, and "
                "Stash is running inside a container. Installing the binary "
                "in here would put binge-server on a port nothing outside "
                "can reach, and it would vanish on the next restart. Add it "
                "as a service alongside Stash instead - binge's Settings "
                "page has the compose snippet to paste.")
            return 1
    elif in_container():
        # Refuse rather than install something unreachable. See in_container.
        log("Stash is running inside a container, and that container has no "
            "access to Docker.")
        log("")
        log("Installing binge-server in here would put it on a port nothing "
            "outside the container can reach, and it would vanish on the "
            "next restart. Add it as a service alongside Stash instead — "
            "binge's Settings page has the compose snippet to paste.")
        return 1
    else:
        log("No Docker on this machine.")
    if method is None:
        method = "binary" if install_binary(publish) else None

    if method is None:
        log("")
        log("Automatic install didn't work. The Settings page has a command "
            "you can paste on the machine running Stash instead.")
        return 1

    log("Waiting for it to come up ...")
    if not wait_for_health():
        log("Installed, but nothing answered on port %d within 90s. Check "
            "the logs: `docker logs %s`." % (PORT, CONTAINER))
        return 1

    log("binge-server is up on port %d." % PORT)
    if method == "binary":
        log("NOTE: installed as a plain background process, so it will not "
            "restart by itself after a reboot. Install Docker, or add it to "
            "your init system, if you want it always on.")
    print(json.dumps({"ok": True, "url": "http://localhost:%d" % PORT,
                      "method": method}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
