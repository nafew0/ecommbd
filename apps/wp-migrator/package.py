"""Build the installable helper ZIP: python3 apps/wp-migrator/package.py

Standard library only. Files come from an explicit allowlist, so tests/, dist/ and any export
or fixture JSON never end up in the ZIP. Timestamps and permissions are fixed, so the same
sources always give the same ZIP.
"""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent
output = root / "dist" / "ecommbd-migrator.zip"

# The plugin itself, the uninstaller, the README, every class in includes/ and the Bangla
# translation in languages/. Only .php files are taken from those two folders.
files = ["ecommbd-migrator.php", "uninstall.php", "README.md"]
files += sorted(str(path.relative_to(root)) for path in (root / "includes").glob("*.php"))
files += sorted(str(path.relative_to(root)) for path in (root / "languages").glob("*.php"))

for name in files:
    if name.startswith(("tests/", "dist/")) or name.endswith(".json"):
        raise SystemExit(f"refusing to package {name}")
    # Every required class must exist, or the plugin would fail on activation.
    if not (root / name).is_file():
        raise SystemExit(f"missing {name}")

output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo("ecommbd-migrator/" + name, date_time=(2026, 10, 23, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
print(output)
for name in files:
    print("  " + name)
