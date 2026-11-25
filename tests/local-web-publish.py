"""Regression: local publishing must include setup downloads without private files/config loss."""
import json
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='rsvp-publisher-') as tmp:
    base = pathlib.Path(tmp)
    source, target = base / 'source', base / 'website'
    def put(parent, name, text):
        path = parent / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    public = {
        'index.html': 'website', 'setup.html': 'setup', 'setup-automatic.html': 'automatic setup', 'admin/index.html': 'admin',
        'INSTALL.md': 'current root installation guide',
        'supabase/install.sql': 'BEGIN; COMMIT;', 'supabase/install-manifest.json': '{}',
        'supabase/studio/manifest.json': '{}', 'supabase/studio/guest-gateway.ts': 'guest source',
        'supabase/studio/admin-invitations.ts': 'admin source',
        'docs/StudioSetup.html': 'cloud guide', 'docs/StudioSetup.js': 'guide copy controls',
        'docs/LocalSetup.html': 'local guide', 'docs/StudioSetup.md': 'plain guide',
        'js/core.js': 'core', 'css/app.css': 'styles', 'locales/en/interface.json': '{}',
    }
    for name, text in public.items():
        put(source, name, text)
    pilot_scripts = ['js/shortcut-device-runner.js', 'js/shortcuts-test-installer.js', 'js/shortcuts-test-page.js']
    for name in pilot_scripts:
        put(source, name, 'synthetic pilot script')
    for name in ['js/config.js', 'js/config.production.js']:
        put(source, name, 'unconfigured default')
    put(source, 'VERSION', '0.9.0-alpha.2\n')
    put(source, 'internal/private.md', 'must not be served')
    put(source, 'supabase/upgrades/legacy.sql', 'retired downloadable SQL')
    put(source, 'supabase/functions/.env.local', 'must not be served')
    put(source, 'supabase/functions/guest-gateway/index.ts', 'modular server source')
    config = base / 'runtime-config.js'
    config.write_text('synthetic public browser configuration')
    put(target, 'INSTALL.md', 'stale installation guide')
    put(target, 'js/config.production.js', 'preserve runtime production defaults')
    command = ['python3', str(root / 'deployment/publish-web.py'), str(source), str(config), str(target)]
    subprocess.run(command, check=True, capture_output=True)
    for name, text in public.items():
        assert (target / name).read_text() == text, name
    assert (target / 'js/config.js').read_text() == config.read_text()
    assert (target / 'js/config.production.js').read_text() == 'preserve runtime production defaults'
    assert json.loads((target / 'version.json').read_text())['version'] == '0.9.0-alpha.2'
    assert not (target / 'internal').exists()
    assert not (target / 'supabase/functions').exists()
    assert not (target / 'supabase/upgrades').exists()
    for name in pilot_scripts:
        assert not (target / name).exists(), name
        assert (source / name).is_file(), name
    subprocess.run(command, check=True, capture_output=True)
    assert (target / 'js/config.production.js').read_text() == 'preserve runtime production defaults'
    outside = base / 'private.html'
    outside.write_text('private')
    (source / 'docs/escape.html').symlink_to(outside)
    assert subprocess.run(command, capture_output=True).returncode != 0
    assert not (target / 'docs/escape.html').exists()
print('PASS local web publisher: SQL/manifests/root installation guide/code assets, repeat publishing, config preservation and pilot-file/private-file/symlink exclusions.')
