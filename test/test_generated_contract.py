"""Real generated contract, mocked model result. Does not claim live consensus."""
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture
def generated(tmp_path, direct_deploy):
    source = subprocess.check_output(
        ['node', str(ROOT / 'examples' / 'earthquake-contract.ts')],
        cwd=ROOT, text=True, encoding='utf-8',
    )
    path = tmp_path / 'earthquake.py'
    path.write_text(source, encoding='utf-8')
    return direct_deploy(str(path), sdk_version="v0.2.16")

@pytest.mark.parametrize('reviewed,expected', [(True, 'RESOLVED'), (False, 'UNRESOLVED')])
def test_required_review_controls_resolution(generated, reviewed, expected):
    spec = json.loads(generated.get_spec())
    result = generated._validate_result({
        'status': 'RESOLVED', 'winnerIndex': 0, 'outcomeId': 'YES', 'confidenceBps': 9000,
        'facts': [], 'rulesApplied': [], 'conflicts': [],
        'featuresApplied': [{'feature': 'REVIEWED', 'satisfied': reviewed, 'explanation': 'Test input'}],
        'reasonCode': 'TEST', 'reasoningSummary': 'Synthetic validation test',
    }, spec)
    assert result['status'] == expected
    assert result['winnerIndex'] == (0 if reviewed else -1)

def test_unregistered_winner_rejected(generated):
    spec = json.loads(generated.get_spec())
    with pytest.raises(Exception, match='WINNER_OUT_OF_RANGE'):
        generated._validate_result({'status': 'RESOLVED', 'winnerIndex': 8, 'outcomeId': 'YES'}, spec)
