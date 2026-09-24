import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('api_listen', Path(__file__).with_name('api_listen.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        module.STATE = Path(self.tmp.name)
        module.LEDGER = module.STATE / 'ledger.json'
        module.agent_usage = lambda: {'conservative_usd': 120.0}

    def tearDown(self):
        self.tmp.cleanup()

    def test_uncertain_request_keeps_entire_reservation(self):
        identity = module.reserve_request('test', [])
        with module.locked_ledger() as ledger:
            self.assertEqual(module.committed(ledger), 5)
        with self.assertRaises(RuntimeError):
            module.finish_request(identity, {'usage': {'prompt_tokens': 500, 'completion_tokens': 10}}, 'test')
        with module.locked_ledger() as ledger:
            self.assertEqual(module.committed(ledger), 5)

    def test_reserved_call_cannot_take_wrapup_money(self):
        module.agent_usage = lambda: {'conservative_usd': 896}
        with self.assertRaises(RuntimeError):
            module.reserve_request('must-not-send', [])
        self.assertEqual(json.loads(module.LEDGER.read_text())['entries'], [])

    def test_usage_replaces_reservation_without_double_counting_audio(self):
        identity = module.reserve_request('test', [])
        response = {'usage': {'prompt_tokens': 1100, 'prompt_tokens_details': {'audio_tokens': 1000}, 'completion_tokens': 200}, 'id': 'test-response'}
        cost = module.finish_request(identity, response, 'test-request')
        self.assertAlmostEqual(cost, 0.03425)
        with module.locked_ledger() as ledger:
            self.assertEqual(module.committed(ledger), cost)

    def test_prior_pending_requests_count_towards_cap(self):
        module.agent_usage = lambda: {'conservative_usd': 890}
        module.reserve_request('one', [])
        module.reserve_request('two', [])
        with self.assertRaises(RuntimeError):
            module.reserve_request('three', [])

if __name__ == '__main__':
    unittest.main()
