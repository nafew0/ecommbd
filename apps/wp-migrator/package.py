"""Build the installable helper ZIP with an explicit file allowlist (standard library only)."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent
output = root / "dist" / "ecommbd-migrator.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for filename in ("ecommbd-migrator.php", "uninstall.php", "README.md"):
        info = ZipInfo("ecommbd-migrator/" + filename, date_time=(2026, 10, 22, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / filename).read_bytes())
print(output)
