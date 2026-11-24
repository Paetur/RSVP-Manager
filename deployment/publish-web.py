"""Publish public website files, setup downloads and guides; preserve installation config."""
import json
import pathlib
import shutil
import sys

# The separate Shortcuts test website copies these from source.
SHORTCUTS_PILOT_SCRIPTS = {
    'js/shortcut-device-runner.js',
    'js/shortcuts-test-installer.js',
    'js/shortcuts-test-page.js',
}

source, config, target = map(pathlib.Path, sys.argv[1:])
source = source.resolve()
files = [pathlib.Path(name) for name in [
    'index.html', 'setup.html', 'setup-automatic.html', 'admin/index.html', 'INSTALL.md',
    'supabase/install.sql', 'supabase/install-manifest.json',
]]
for folder, suffixes in [
    ('js', {'.js'}), ('css', {'.css'}), ('locales', {'.json'}),
    ('docs', {'.md', '.html', '.js'}), ('supabase/studio', {'.ts', '.json'}),
]:
    files.extend(p.relative_to(source) for p in (source / folder).rglob('*')
                 if p.is_file() and p.suffix in suffixes
                 and not any(part.startswith('.') for part in p.relative_to(source).parts)
                 and p.relative_to(source).as_posix() not in SHORTCUTS_PILOT_SCRIPTS)
for name in files:
    origin = (source / name).resolve()
    if not origin.is_relative_to(source):
        raise SystemExit('Refusing symlink outside repository')
    dest = target / name
    if name == pathlib.Path('js/config.js'):
        origin = config.resolve()
    elif name == pathlib.Path('js/config.production.js') and dest.is_file():
        continue
    dest.parent.mkdir(parents=True, exist_ok=True)
    if origin != dest.resolve():
        shutil.copyfile(origin, dest)
    dest.chmod(0o644)
version_file = source / 'version.json'
version = json.loads(version_file.read_text()) if version_file.is_file() else {
    'version': (source / 'VERSION').read_text().strip(),
}
(target / 'version.json').write_text(json.dumps(version, indent=2) + '\n')
(target / 'version.json').chmod(0o644)
for directory in [target, *[p for p in target.rglob('*') if p.is_dir()]]:
    directory.chmod(0o755)
print(f'Published {len(files) + 1} public files including setup SQL and guides; kept installation configuration.')
