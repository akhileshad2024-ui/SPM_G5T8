"""US27 interval rules independently of HTTP, SQL or event fixtures."""
from datetime import datetime, timedelta
from types import SimpleNamespace
import pytest
from equipment import peak_reserved

START = datetime(2027, 1, 4, 9)

def hold(start, end, qty):
    return SimpleNamespace(start=START+timedelta(hours=start), end=START+timedelta(hours=end), quantity=qty)

@pytest.mark.parametrize('rows,expected', [
    ([], 0),
    ([hold(0, 1, 4), hold(1, 2, 4)], 4),
    ([hold(0, 2, 4), hold(1, 3, 2)], 6),
    ([hold(-2, 0, 8), hold(3, 4, 9)], 0),
    ([hold(-2, 4, 5)], 5),
    ([hold(0, 1, 2), hold(1, 2, 3), hold(2, 3, 4)], 4),
])
def test_period_peak_respects_adjacency_and_clips_to_event(rows, expected):
    assert peak_reserved(rows, START, START+timedelta(hours=3)) == expected
