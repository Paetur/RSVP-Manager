"""Fail-closed hosted verification against synthetic GitHub responses; no network."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('pages',Path(__file__).resolve().parents[1]/'deployment/build-pages.py')
pages=importlib.util.module_from_spec(spec);spec.loader.exec_module(pages)
class FullGateTests(unittest.TestCase):
    def test_required_jobs_and_exact_commit(self):
        commit='a'*40
        run={'id':7,'head_sha':commit,'status':'completed','conclusion':'success'}
        jobs=[{'name':name,'status':'completed','conclusion':'success'} for name in ['household-database','guest-feedback-concurrency','browser-smoke']]
        def response(run_value=run,job_values=jobs):
            def read(url):
                if '/commits/' in url:return json.dumps({'sha':commit}).encode()
                if '/runs?' in url:return json.dumps({'workflow_runs':[run_value]}).encode()
                if '/jobs?' in url:return json.dumps({'jobs':job_values}).encode()
                raise AssertionError('Unexpected network route '+url)
            return read
        with patch.object(pages,'download',response()):
            self.assertEqual(pages.verify_full_ci('owner/release','v0.9.0-alpha.3')['commit'],commit)
        cases=[({'head_sha':'b'*40},jobs),({'status':'in_progress'},jobs),({'conclusion':'failure'},jobs),({},[]),({},jobs[:-1]),({},[{**jobs[0],'conclusion':'skipped'},*jobs[1:]])]
        for changes,values in cases:
            with self.subTest(changes=changes,values=values),patch.object(pages,'download',response({**run,**changes},values)),self.assertRaisesRegex(ValueError,'Full CI'):
                pages.verify_full_ci('owner/release','v0.9.0-alpha.3')
    def test_failed_gate_prevents_archive_download(self):
        requested=[]
        def read(url):
            requested.append(url)
            if '/releases/tags/' in url:return json.dumps({'tag_name':'v0.9.0-alpha.3','draft':False,'assets':[]}).encode()
            raise AssertionError('Archive download must not be reached')
        with tempfile.TemporaryDirectory() as tmp,patch.object(pages,'download',read),patch.object(pages,'verify_full_ci',side_effect=ValueError('Full CI required')),self.assertRaisesRegex(ValueError,'Full CI'):
            pages.fetch_release('owner/release','v0.9.0-alpha.3',Path(tmp))
        self.assertEqual(len(requested),1)
if __name__=='__main__':unittest.main()
