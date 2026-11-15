"""Verify deployment artifacts and rejection boundaries using synthetic releases."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('pages', Path(__file__).resolve().parents[1] / 'deployment/build-pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.version = '0.9.0-alpha.2'

    def archive(self, change=None, extra=None):
        files = {name: b'fixture' for name in ['index.html', 'setup.html', 'admin/index.html', 'js/core.js', 'js/config.js', 'css/style.css', 'supabase/install.sql', 'supabase/upgrades/alpha6-to-alpha7.sql', 'supabase/functions/private.ts', 'tests/private.cjs']}
        manifest = {'version': self.version, 'sourceCommit': 'synthetic', 'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        files['release-manifest.json'] = json.dumps(manifest).encode()
        files['SHA256SUMS'] = b'synthetic checksums; manifest hashes are independently checked'
        if change:
            change(files)
        archive = self.root / 'release.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            for name, data in files.items():
                z.writestr('rsvp-manager-' + self.version + '/' + name, data)
            if extra:
                z.writestr(*extra)
        return archive

    def test_public_snapshot_and_unconfigured_setup(self):
        archive = self.archive()
        before = archive.read_bytes()
        output = self.root / 'site'
        info = pages.build_site(archive, output, self.version, 'marriage')
        self.assertFalse(info['backendConfigured'])
        self.assertIn('marriage/', (output / 'index.html').read_text())
        self.assertTrue((output / '.nojekyll').is_file())
        self.assertTrue((output / 'marriage/supabase/install.sql').is_file())
        self.assertTrue((output / 'marriage/supabase/upgrades/alpha6-to-alpha7.sql').is_file())
        self.assertFalse((output / 'marriage/tests').exists())
        self.assertFalse((output / 'marriage/supabase/functions').exists())
        self.assertIn('"supabaseUrl": ""', (output / 'marriage/js/config.js').read_text())
        manifest = json.loads((output / 'marriage/deployment-manifest.json').read_text())
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((output / 'marriage' / name).read_bytes()).hexdigest(), digest)
        self.assertEqual(before, archive.read_bytes())
        with self.assertRaises(ValueError):
            pages.build_site(archive, output, self.version, 'marriage')

    def test_root_installation_preserves_application_index(self):
        archive = self.archive()
        output = self.root / 'site'
        info = pages.build_site(archive, output, self.version, '')
        self.assertEqual(info['path'], '/')
        self.assertFalse(info['backendConfigured'])
        self.assertEqual((output / 'index.html').read_bytes(), b'fixture')
        self.assertTrue((output / 'admin/index.html').is_file())
        self.assertTrue((output / 'setup.html').is_file())
        self.assertTrue((output / '.nojekyll').is_file())
        self.assertFalse((output / 'marriage').exists())
        manifest = json.loads((output / 'deployment-manifest.json').read_text())
        self.assertEqual(hashlib.sha256((output / 'index.html').read_bytes()).hexdigest(), manifest['files']['index.html'])

    def test_backend_configuration(self):
        output = self.root / 'site'
        info = pages.build_site(self.archive(), output, self.version, 'events/marriage', 'https://project.example.invalid/', 'sb_publishable_synthetic')
        self.assertTrue(info['backendConfigured'])
        self.assertEqual(info['path'], '/events/marriage/')
        self.assertIn('https://project.example.invalid', (output / 'events/marriage/js/config.js').read_text())
        claims = base64.urlsafe_b64encode(json.dumps({'role': 'anon'}).encode()).decode().rstrip('=')
        self.assertEqual(pages.connection('https://project.example.invalid', 'test.' + claims + '.signature')['supabaseKey'], 'test.' + claims + '.signature')
        for url, key in [('https://project.example.invalid', ''), ('', 'sb_publishable_synthetic'), ('http://project.example.invalid', 'sb_publishable_synthetic'), ('https://project.example.invalid/path', 'sb_publishable_synthetic'), ('https://user:pass@project.example.invalid', 'sb_publishable_synthetic'), ('https://project.example.invalid', 'sb_secret_synthetic')]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pages.connection(url, key)
        privileged = base64.urlsafe_b64encode(json.dumps({'role': 'service_role'}).encode()).decode().rstrip('=')
        with self.assertRaises(ValueError):
            pages.connection('https://project.example.invalid', 'test.' + privileged + '.signature')

    def test_path_and_archive_boundaries(self):
        for value in ['/', '../marriage', 'marriage/../other', 'marriage%2fother', 'marriage//other', 'marriage?x=1']:
            with self.subTest(path=value), self.assertRaises(ValueError):
                pages.checked_path(value)
        with self.assertRaisesRegex(ValueError, 'checksum'):
            pages.unpack_verified(self.archive(lambda f: f.update({'js/core.js': b'tampered'})), self.root / 'tampered', self.version)
        with self.assertRaises(ValueError):
            pages.unpack_verified(self.archive(extra=('rsvp-manager-' + self.version + '/../escaped', b'unsafe')), self.root / 'escaped', self.version)
        link = zipfile.ZipInfo('rsvp-manager-' + self.version + '/link')
        link.external_attr = 0o120777 << 16
        with self.assertRaisesRegex(ValueError, 'symlink'):
            pages.unpack_verified(self.archive(extra=(link, b'../../escape')), self.root / 'linked', self.version)
        with self.assertRaisesRegex(ValueError, 'file list'):
            pages.unpack_verified(self.archive(lambda f: f.pop('admin/index.html')), self.root / 'missing', self.version)

if __name__ == '__main__':
    unittest.main()
