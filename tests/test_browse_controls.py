from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PATCH = (ROOT / "js" / "browse-sheet-fix.js").read_text(encoding="utf-8")
APP = (ROOT / "js" / "app.js").read_text(encoding="utf-8")


def test_browse_sheet_fix_is_loaded_after_app():
    app_script = 'src="js/app.js'
    browse_fix = 'src="js/browse-sheet-fix.js"'
    assert app_script in INDEX
    assert browse_fix in INDEX
    assert INDEX.index(app_script) < INDEX.index(browse_fix)


def test_sheet_backdrop_is_repaired_without_breaking_inner_controls():
    assert "mask.removeAttribute('data-close-sheet')" in PATCH
    assert "if (event.target !== mask) return;" in PATCH
    assert "new MutationObserver(repairCurrentSheet)" in PATCH


def test_existing_sort_and_filter_actions_remain_wired():
    for sort_value in ("recommended", "newest", "popular", "price_asc", "price_desc"):
        assert "filters.sort = '%s'; load();" % sort_value in APP
    assert "$('#btn-filter').addEventListener('click', function () { showFilterSheet(); });" in APP
    assert "$('#fs-apply').addEventListener('click'" in APP
    assert "$('#fs-clear').addEventListener('click'" in APP
